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
    REGULAR_TEXT_STREAM_DELAY
)

from langgraph.types import Command
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel
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
    
    # 2. Create User Message in memory (Do NOT save to DB yet)
    user_msg_content = [{"type": "text", "text": payload.content}]
    user_message = Message(
        id=payload.id if payload.id else str(uuid.uuid4()),
        thread_id=thread_id,
        parent_id=payload.parentId,
        role="user",
        content=json.dumps(user_msg_content)
    )

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
                from app.agent import insert_paragraph, insert_table, insert_list, apply_style
                graph_tools = [mock_think, mock_search_kb, mock_check_entitlements, insert_paragraph, insert_table, insert_list, apply_style]
            except Exception as e:
                print("Failed to load mock_tools:", e)
                
        
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

        try:
            async with AsyncSqliteSaver.from_conn_string("langgraph_checkpoints.db") as memory:
                agent_graph = create_agent_graph(llm, tools=graph_tools, checkpointer=memory)
                config = {"configurable": {"thread_id": thread_id}}
                # stream_mode="updates" streams state modifications node by node
                async for update in agent_graph.astream(state, config, stream_mode="updates"):
                    if "__interrupt__" in update:
                        interrupt_obj = update["__interrupt__"][0]
                        interrupt_payload = interrupt_obj.value
                        yield f"event: requires_action\ndata: {json.dumps(interrupt_payload)}\n\n"
                        break
                        
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
            pass

        # 5. Defer persistence to explicit /commit endpoint


    return StreamingResponse(sse_generator(), media_type="text/event-stream")

import base64
import y_py as Y
from fastapi.responses import JSONResponse, Response
from database import Document, DocumentTemplate
from app.config import DEFAULT_TEMPLATE_ID

@router.get("/templates/{theme_hash}")
def get_template_by_hash(theme_hash: str, db: Session = Depends(get_db)):
    template = db.query(DocumentTemplate).filter(DocumentTemplate.theme_hash == theme_hash).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    return Response(
        content=template.docx_blob,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable"
        }
    )

@router.get("/threads/{thread_id}/document")
def get_document(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    document = db.query(Document).filter(Document.thread_id == thread_id).first()
    
    default_template = db.query(DocumentTemplate).filter(DocumentTemplate.id == DEFAULT_TEMPLATE_ID).first()
    if not default_template:
        default_template = db.query(DocumentTemplate).first()
        if not default_template:
            raise HTTPException(status_code=500, detail="No templates found in the database.")
            
    if not document:
        document = Document(
            thread_id=thread_id,
            template_id=default_template.id,
            theme_hash=default_template.theme_hash,
            latest_snapshot=None
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        
    active_hash = document.theme_hash or default_template.theme_hash
    active_template = db.query(DocumentTemplate).filter(DocumentTemplate.theme_hash == active_hash).first()
    if not active_template:
        active_template = default_template

    try:
        num_dict = json.loads(active_template.numbering_json) if active_template.numbering_json else {}
    except Exception:
        num_dict = {}
        
    return JSONResponse(content={
        "default_theme_hash": default_template.theme_hash,
        "theme_hash": document.theme_hash or default_template.theme_hash,
        "numbering_json": num_dict,
        "latest_snapshot": base64.b64encode(document.latest_snapshot).decode('utf-8') if document.latest_snapshot else None
    })

@router.put("/threads/{thread_id}/document")
async def put_document(thread_id: str, request: Request, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    document = db.query(Document).filter(Document.thread_id == thread_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    try:
        delta = await request.body()
        if not delta:
            return {"status": "success", "message": "No delta provided"}
            
        if document.latest_snapshot:
            # Apply delta to existing snapshot
            ydoc = Y.YDoc()
            Y.apply_update(ydoc, document.latest_snapshot)
            Y.apply_update(ydoc, delta)
            document.latest_snapshot = Y.encode_state_as_update(ydoc)
            
            # Extract themeHash from Yjs metadata
            try:
                metadata_map = ydoc.get_map('metadata')
                theme_hash = metadata_map.get('themeHash')
                if theme_hash:
                    document.theme_hash = theme_hash
            except Exception as e:
                print("Failed to extract themeHash from snapshot in put_document:", e)
        else:
            # No snapshot yet, the delta becomes the snapshot
            document.latest_snapshot = delta
            try:
                ydoc = Y.YDoc()
                Y.apply_update(ydoc, delta)
                metadata_map = ydoc.get_map('metadata')
                theme_hash = metadata_map.get('themeHash')
                if theme_hash:
                    document.theme_hash = theme_hash
            except Exception as e:
                print("Failed to extract themeHash from delta in put_document:", e)
            
        db.commit()
        return {"status": "success", "message": "Document updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save document: {str(e)}")

class CommitPayload(BaseModel):
    user_message_id: str
    parent_id: Optional[str] = None
    user_content: str
    assistant_message_id: str
    assistant_parts: list

@router.post("/threads/{thread_id}/commit")
async def commit_turn(thread_id: str, request: Request, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    metadata_header = request.headers.get("X-Commit-Metadata")
    if not metadata_header:
        raise HTTPException(status_code=400, detail="Missing X-Commit-Metadata header")
    metadata = json.loads(metadata_header)
    payload = CommitPayload(**metadata)

    delta = await request.body()
    
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    document = db.query(Document).filter(Document.thread_id == thread_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    if thread.title == "New Chat":
        words = payload.user_content.split()
        title_str = " ".join(words[:6])
        if len(words) > 6:
            title_str += "..."
        thread.title = title_str

    # 1. Save user message
    user_msg_content = [{"type": "text", "text": payload.user_content}]
    user_message = Message(
        id=payload.user_message_id,
        thread_id=thread_id,
        parent_id=payload.parent_id,
        role="user",
        content=json.dumps(user_msg_content)
    )
    db.add(user_message)
    
    # 2. Save assistant message and delta_blob
    assistant_message = Message(
        id=payload.assistant_message_id,
        thread_id=thread_id,
        parent_id=payload.user_message_id,
        role="assistant",
        content=json.dumps(payload.assistant_parts),
        delta_blob=delta if delta else None
    )
    db.add(assistant_message)
    
    # 3. Apply delta to document.latest_snapshot
    if delta:
        if document.latest_snapshot:
            ydoc = Y.YDoc()
            Y.apply_update(ydoc, document.latest_snapshot)
            Y.apply_update(ydoc, delta)
            document.latest_snapshot = Y.encode_state_as_update(ydoc)
            try:
                metadata_map = ydoc.get_map('metadata')
                theme_hash = metadata_map.get('themeHash')
                if theme_hash:
                    document.theme_hash = theme_hash
            except Exception as e:
                print("Failed to extract themeHash from snapshot in commit_turn:", e)
        else:
            document.latest_snapshot = delta
            try:
                ydoc = Y.YDoc()
                Y.apply_update(ydoc, delta)
                metadata_map = ydoc.get_map('metadata')
                theme_hash = metadata_map.get('themeHash')
                if theme_hash:
                    document.theme_hash = theme_hash
            except Exception as e:
                print("Failed to extract themeHash from delta in commit_turn:", e)
            
    db.commit()
    return {"status": "success"}


class ResumePayload(BaseModel):
    client_results: list
    assistantMessageId: str
    parentId: Optional[str] = None

@router.post("/threads/{thread_id}/messages/resume")
async def resume_message(thread_id: str, payload: ResumePayload, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    async def resume_generator():
        llm = get_polymorphic_llm()
        
        if hasattr(llm, "user_id"):
            llm.user_id = current_user["user_id"]
        if hasattr(llm, "fullname"):
            llm.fullname = current_user["fullname"]

        graph_tools = None
        if USE_MOCK_LLM:
            try:
                from app.mock_showcase.mock_tools import think as mock_think, search_kb as mock_search_kb, check_entitlements as mock_check_entitlements
                from app.agent import insert_paragraph, insert_table, insert_list, apply_style
                graph_tools = [mock_think, mock_search_kb, mock_check_entitlements, insert_paragraph, insert_table, insert_list, apply_style]
            except Exception as e:
                pass

        async with AsyncSqliteSaver.from_conn_string("langgraph_checkpoints.db") as memory:
            agent_graph = create_agent_graph(llm, tools=graph_tools, checkpointer=memory)
            config = {"configurable": {"thread_id": thread_id}}
            
            # Fetch the state to reconstruct current messages
            state_snapshot = await agent_graph.aget_state(config)
            if not state_snapshot.next:
                yield f"event: error\ndata: No suspended execution found\n\n"
                return
                
            messages = list(state_snapshot.values.get("messages", []))
            
            initial_msg_count = 0
            for i in range(len(messages) - 1, -1, -1):
                # Langchain messages type check
                if getattr(messages[i], "type", "") == "human":
                    initial_msg_count = i + 1
                    break
                    
            reasoning_steps = list(state_snapshot.values.get("reasoning_steps", []))
            has_streamed_text = False
            parts = []

            try:
                async for update in agent_graph.astream(Command(resume=payload.client_results), config, stream_mode="updates"):
                    if "__interrupt__" in update:
                        interrupt_obj = update["__interrupt__"][0]
                        out_payload = interrupt_obj.value
                        yield f"event: requires_action\ndata: {json.dumps(out_payload)}\n\n"
                        break
                        
                    for node_name, node_data in update.items():
                        if "messages" in node_data:
                            for m in node_data["messages"]:
                                if m not in messages:
                                    messages.append(m)
                        if "reasoning_steps" in node_data:
                            reasoning_steps = node_data["reasoning_steps"]
                            
                    rebuilt_parts = []
                    for step in reasoning_steps:
                        rebuilt_parts.append({"type": "reasoning", "text": step})
                        
                    for msg in messages[initial_msg_count:]:
                        if getattr(msg, "type", "") == "ai" and msg.tool_calls:
                            for tc in msg.tool_calls:
                                if tc["name"] != "think":
                                    tc_id = tc["id"]
                                    tool_res = None
                                    for tm in messages[initial_msg_count:]:
                                        if getattr(tm, "type", "") == "tool" and tm.tool_call_id == tc_id:
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
                                    
                    final_text = ""
                    for msg in reversed(messages[initial_msg_count:]):
                        if getattr(msg, "type", "") == "ai" and msg.content and not msg.tool_calls:
                            final_text = msg.content
                            break
                            
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
                    elif not final_text:
                        yield f"event: parts\ndata: {json.dumps(rebuilt_parts)}\n\n"

                # Prepare parts for database
                final_rebuilt_parts = []
                for step in reasoning_steps:
                    final_rebuilt_parts.append({"type": "reasoning", "text": step})
                
                for msg in messages[initial_msg_count:]:
                    if getattr(msg, "type", "") == "ai" and msg.tool_calls:
                        for tc in msg.tool_calls:
                            if tc["name"] != "think":
                                tc_id = tc["id"]
                                tool_res = None
                                for tm in messages[initial_msg_count:]:
                                    if getattr(tm, "type", "") == "tool" and tm.tool_call_id == tc_id:
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
                    if getattr(msg, "type", "") == "ai" and msg.content and not msg.tool_calls:
                        final_text = msg.content
                        break
                if final_text:
                    final_rebuilt_parts.append({"type": "text", "text": final_text})
                parts = final_rebuilt_parts

            except Exception as err:
                print("Error in resume generator:", err)
            finally:
                pass
                
            # Defer upsert logic to explicit /commit endpoint

    return StreamingResponse(resume_generator(), media_type="text/event-stream")
