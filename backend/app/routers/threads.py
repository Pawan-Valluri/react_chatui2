# backend/app/routers/threads.py

import uuid
import json
import asyncio
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db, Thread, Message
from app.agent import create_agent_graph
from app.auth import get_current_user
from app.schemas import MessageCreate, ThreadCreate
from app.llm import get_polymorphic_llm
from app.config import (
    USE_MOCK_LLM,
    ENABLE_STREAMING,
    REASONING_STEP_DELAY,
    TOOL_RUNNING_DELAY,
    TOOL_COMPLETE_DELAY,
    TEXT_STREAM_DELAY,
    REGULAR_REASONING_DELAY,
    REGULAR_TOOL_RUNNING_DELAY,
    REGULAR_TOOL_COMPLETE_DELAY,
    REGULAR_TEXT_STREAM_DELAY
)

import database

router = APIRouter(prefix="/api")

@router.get("/threads")
def list_threads(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    threads = db.query(Thread).filter(Thread.user_id == current_user["user_id"]).order_by(Thread.created_at.desc()).all()
    return [t.to_dict() for t in threads]

@router.post("/threads")
def create_thread(data: ThreadCreate, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    new_thread = Thread(title=data.title, user_id=current_user["user_id"])
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)
    return new_thread.to_dict()

@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    db.delete(thread)
    db.commit()
    return {"status": "success", "message": f"Thread {thread_id} deleted"}

@router.get("/threads/{thread_id}/messages")
def list_messages(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    messages = db.query(Message).filter(Message.thread_id == thread_id).order_by(Message.created_at.asc()).all()
    return [m.to_dict() for m in messages]

@router.post("/threads/{thread_id}/messages")
async def send_message(thread_id: str, payload: MessageCreate, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # 1. Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    # 2. Save User Message to database
    user_msg_content = [{"type": "text", "text": payload.content}]
    user_message = Message(
        id=payload.id if payload.id else str(uuid.uuid4()),
        thread_id=thread_id,
        parent_id=payload.parentId,
        role="user",
        content=json.dumps(user_msg_content)
    )
    db.add(user_message)
    db.commit()
    
    # 3. Update Thread Title if it is still default "New Chat"
    if thread.title == "New Chat":
        # Create a clean title based on first 6 words
        words = payload.content.split()
        title_str = " ".join(words[:6])
        if len(words) > 6:
            title_str += "..."
        thread.title = title_str
        db.commit()

    # 4. SSE Stream Generator
    async def sse_generator():
        llm = get_polymorphic_llm()
        
        # Inject current user context into the polymorphic mock model if active
        if hasattr(llm, "user_id"):
            llm.user_id = current_user["user_id"]
        if hasattr(llm, "fullname"):
            llm.fullname = current_user["fullname"]

        # Compile the graph dynamically using our injected LLM.
        # If USE_MOCK_LLM is true, we load and pass the custom mock tools containing simulated delays.
        # Otherwise, the graph compiles with the pristine, mock-free production tools defined inside agent.py.
        graph_tools = None
        if USE_MOCK_LLM:
            try:
                from app.mock_showcase.mock_tools import think as mock_think, search_kb as mock_search_kb, check_entitlements as mock_check_entitlements
                from app.agent import (
                    read_document, read_selection, read_page, read_pages,
                    find_text, read_comments, read_changes,
                    add_comment, suggest_change, apply_formatting,
                    set_paragraph_style, reply_comment, resolve_comment, scroll,
                    insert_table, edit_table_cell, toggle_bullet_list,
                    add_table_row, delete_table_row, add_table_column, delete_table_column,
                    append_paragraph
                )
                graph_tools = [
                    mock_think, mock_search_kb, mock_check_entitlements,
                    read_document, read_selection, read_page, read_pages,
                    find_text, read_comments, read_changes,
                    add_comment, suggest_change, apply_formatting,
                    set_paragraph_style, reply_comment, resolve_comment, scroll,
                    insert_table, edit_table_cell, toggle_bullet_list,
                    add_table_row, delete_table_row, add_table_column, delete_table_column,
                    append_paragraph
                ]
            except Exception as e:
                print("Failed to load mock_tools:", e)
                
        agent_graph = create_agent_graph(llm, tools=graph_tools)

        # 1. Fetch thread history from DB to build dynamic context state for branching.
        # Since the user could edit a previous message to create a branch, we reconstruct the exact linear path
        # of the active branch by traversing parent_id pointers backward starting from user_message.parent_id.
        all_thread_msgs = db.query(Message).filter(Message.thread_id == thread_id).all()
        msg_map = {m.id: m for m in all_thread_msgs}
        
        ancestors = []
        curr_parent_id = user_message.parent_id
        while curr_parent_id and curr_parent_id in msg_map:
            ancestor_msg = msg_map[curr_parent_id]
            ancestors.append(ancestor_msg)
            curr_parent_id = ancestor_msg.parent_id
            
        # Reverse to get chronological order (oldest to newest) leading up to our new user message
        ancestors.reverse()
        db_messages = ancestors
        
        from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
        
        state_messages = []
        for msg in db_messages:
            # Reconstruct content parts
            try:
                content_parts = json.loads(msg.content)
            except Exception:
                content_parts = [{"type": "text", "text": msg.content}]
                
            if msg.role == "user":
                # User prompt
                txt = "".join(p.get("text", "") for p in content_parts if p.get("type") == "text")
                state_messages.append(HumanMessage(content=txt, id=msg.id))
            else:
                # Reconstruct assistant reasoning (think tool calls), tool usages, and text
                # We group them in sequential AI / Tool messages matching how they were recorded
                ai_tool_calls = []
                for p in content_parts:
                    if p.get("type") == "reasoning":
                        # Map reasoning back to virtual think tool call
                        ai_tool_calls.append({
                            "name": "think",
                            "args": {"thought": p.get("text", "")},
                            "id": f"tc_think_hist_{msg.id}_{len(ai_tool_calls)}",
                            "type": "tool_call"
                        })
                    elif p.get("type") == "tool-call":
                        # Map dynamic tool call logs back
                        ai_tool_calls.append({
                            "name": p.get("toolName", ""),
                            "args": p.get("args", {}),
                            "id": p.get("toolCallId", ""),
                            "type": "tool_call"
                        })
                
                # Check for standard textual response in content parts
                txt_response = "".join(p.get("text", "") for p in content_parts if p.get("type") == "text")
                
                # Append standard AIMessage if there were tool calls or text response
                if ai_tool_calls or txt_response:
                    state_messages.append(AIMessage(
                        content=txt_response,
                        tool_calls=ai_tool_calls,
                        id=msg.id
                    ))
                
                # Append subsequent ToolMessage outputs
                for p in content_parts:
                    if p.get("type") == "tool-call" and p.get("result") is not None:
                        state_messages.append(ToolMessage(
                            content=str(p.get("result", "")),
                            name=p.get("toolName", ""),
                            tool_call_id=p.get("toolCallId", ""),
                            id=f"tm_hist_{msg.id}_{p.get('toolCallId', '')}"
                        ))

        # Append the active new user prompt at the end of the history context
        state_messages.append(HumanMessage(content=payload.content, id=user_message.id))

        state = {
            "messages": state_messages,
            "reasoning_steps": [],
            "loop_counter": 0
        }

        # Initialize parts list
        parts = []

        # Yield an initial empty reasoning part instantly to trigger client-side mounting
        parts.append({"type": "reasoning", "text": ""})
        yield f"event: parts\ndata: {json.dumps(parts)}\n\n"

        # Accumulate state internally
        initial_msg_count = len(state["messages"])
        messages = list(state["messages"])
        reasoning_steps = []
        has_streamed_text = False

        from app.services.document_service import current_thread_id_var
        from app.agent import current_document_context_var
        token = current_thread_id_var.set(thread_id)
        context_token = current_document_context_var.set(payload.context)
        try:
            # stream_mode="updates" streams state modifications node by node
            async for update in agent_graph.astream(state, stream_mode="updates"):
                for node_name, node_data in update.items():
                    if "messages" in node_data:
                        # Append any new messages produced by the node
                        for m in node_data["messages"]:
                            if m not in messages:
                                messages.append(m)
                    if "reasoning_steps" in node_data:
                        reasoning_steps = node_data["reasoning_steps"]

                # Reconstruct rebuilt_parts dynamically from accumulated messages and reasoning_steps
                rebuilt_parts = []
                
                # 1. Add reasoning steps
                for step in reasoning_steps:
                    rebuilt_parts.append({"type": "reasoning", "text": step})
                    
                # 2. Add system tool calls (filtering out the virtual 'think' tool calls)
                # Slice from initial_msg_count to only scan new assistant tool calls generated in the current turn
                for msg in messages[initial_msg_count:]:
                    if isinstance(msg, AIMessage) and msg.tool_calls:
                        for tc in msg.tool_calls:
                            if tc["name"] != "think":
                                tc_id = tc["id"]
                                # Search for the corresponding ToolMessage result
                                tool_res = None
                                for tm in messages[initial_msg_count:]:
                                    if isinstance(tm, ToolMessage) and tm.tool_call_id == tc_id:
                                        tool_res = tm.content
                                        break
                                
                                status = "complete" if tool_res is not None else "running"
                                rebuilt_parts.append({
                                    "type": "tool-call",
                                    "toolCallId": tc_id,
                                    "toolName": tc["name"],
                                    "args": tc["args"],
                                    "status": status,
                                    "result": tool_res
                                })

                # Reconstruct final text response if present
                final_text = ""
                for msg in reversed(messages[initial_msg_count:]):
                    if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
                        final_text = msg.content
                        break

                # Stream final text with typewriter if enabled, or immediately
                if final_text and not has_streamed_text:
                    has_streamed_text = True
                    if ENABLE_STREAMING:
                        words = final_text.split(" ")
                        current_text = ""
                        for word in words:
                            if current_text:
                                current_text += " "
                            current_text += word
                            parts_to_yield = list(rebuilt_parts) + [{"type": "text", "text": current_text}]
                            yield f"event: parts\ndata: {json.dumps(parts_to_yield)}\n\n"
                            await asyncio.sleep(REGULAR_TEXT_STREAM_DELAY)
                    else:
                        parts_to_yield = list(rebuilt_parts) + [{"type": "text", "text": final_text}]
                        yield f"event: parts\ndata: {json.dumps(parts_to_yield)}\n\n"
                
                # If we haven't hit final text response yet, yield the current progress parts!
                elif not final_text:
                    yield f"event: parts\ndata: {json.dumps(rebuilt_parts)}\n\n"

            # 4. Save final state to DB after stream finishes
            final_rebuilt_parts = []
            for step in reasoning_steps:
                final_rebuilt_parts.append({"type": "reasoning", "text": step})
            
            for msg in messages[initial_msg_count:]:
                if isinstance(msg, AIMessage) and msg.tool_calls:
                    for tc in msg.tool_calls:
                        if tc["name"] != "think":
                            tc_id = tc["id"]
                            tool_res = None
                            for tm in messages[initial_msg_count:]:
                                if isinstance(tm, ToolMessage) and tm.tool_call_id == tc_id:
                                    tool_res = tm.content
                                    break
                            status = "complete" if tool_res is not None else "running"
                            final_rebuilt_parts.append({
                                "type": "tool-call",
                                "toolCallId": tc_id,
                                "toolName": tc["name"],
                                "args": tc["args"],
                                "status": status,
                                "result": tool_res
                            })
            
            final_text = ""
            for msg in reversed(messages[initial_msg_count:]):
                if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
                    final_text = msg.content
                    break
            if final_text:
                final_rebuilt_parts.append({"type": "text", "text": final_text})

            # Update parts variable so it is captured for database persistence below
            parts = final_rebuilt_parts

        except Exception as err:
            print("Error encountered in agent graph stream:", err)
        finally:
            current_thread_id_var.reset(token)
            current_document_context_var.reset(context_token)

        # 5. Persist final assistant parts to database
        db_assistant = Message(
            id=payload.assistantMessageId if payload.assistantMessageId else str(uuid.uuid4()),
            thread_id=thread_id,
            parent_id=user_message.id,
            role="assistant",
            content=json.dumps(parts)
        )
        db_new = database.SessionLocal()
        try:
            db_new.add(db_assistant)
            db_new.commit()
        finally:
            db_new.close()

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@router.get("/threads/{thread_id}/document")
def get_document(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    from app.services.document_service import get_document_bytes
    from fastapi.responses import Response
    
    try:
        data = get_document_bytes(thread_id)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename=thread_{thread_id}.docx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load document: {str(e)}")

@router.put("/threads/{thread_id}/document")
async def put_document(thread_id: str, request: Request, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    from app.services.document_service import save_document_bytes
    
    try:
        data = await request.body()
        save_document_bytes(thread_id, data)
        return {"status": "success", "message": "Document updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save document: {str(e)}")

