# backend/app/routers/threads.py

import uuid
import json
import asyncio
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db, Thread, Message, Attachment
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


def _reconstruct_snapshot(thread_id: str, start_msg, db, document_latest_snapshot=None) -> bytes:
    import pycrdt
    from app.database import Message
    ancestors = []
    curr_msg = start_msg
    while curr_msg:
        ancestors.append(curr_msg)
        if curr_msg.checkpoint_snapshot:
            break
        if not curr_msg.parent_id:
            break
        curr_msg = db.query(Message).filter(Message.id == curr_msg.parent_id, Message.thread_id == thread_id).first()

    ancestors.reverse()
    ydoc = pycrdt.Doc()

    if not ancestors:
        if document_latest_snapshot:
            ydoc.apply_update(document_latest_snapshot)
        return ydoc.get_update()

    base_msg = ancestors[0]
    start_idx = 0
    if base_msg.checkpoint_snapshot:
        ydoc.apply_update(base_msg.checkpoint_snapshot)
        start_idx = 1
    elif document_latest_snapshot:
        ydoc.apply_update(document_latest_snapshot)

    for msg in ancestors[start_idx:]:
        if msg.delta_blob:
            try:
                ydoc.apply_update(msg.delta_blob)
            except Exception as e:
                print(f"Failed to apply delta for msg {msg.id}:", e)

    return ydoc.get_update()


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

import os
import tempfile
from markitdown import MarkItDown

@router.post("/threads/{thread_id}/attachments")
async def upload_attachment(thread_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    md = MarkItDown()
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
        content = await file.read()
        temp_file.write(content)
        temp_path = temp_file.name
        
    try:
        result = md.convert(temp_path)
        markdown_text = result.text_content
    except Exception as e:
        os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"MarkItDown conversion failed: {str(e)}")
        
    os.remove(temp_path)
    
    llm = get_polymorphic_llm()
    prompt = f"Summarize the following markdown document into a 150-200 word summary and a Table of Contents based on its headers:\n\n{markdown_text[:10000]}"
    try:
        skeleton_response = llm.invoke(prompt)
        skeleton = skeleton_response.content if hasattr(skeleton_response, 'content') else str(skeleton_response)
    except Exception as e:
        skeleton = "Summary generation failed."

    new_attachment = Attachment(
        thread_id=thread_id,
        filename=file.filename,
        markdown_content=markdown_text,
        skeleton=skeleton
    )
    db.add(new_attachment)
    db.commit()
    db.refresh(new_attachment)
    
    # Sync with FTS
    db.execute(text("INSERT INTO attachments_fts(id, thread_id, filename, markdown_content, skeleton) VALUES (:id, :thread_id, :filename, :markdown_content, :skeleton)"),
               {"id": new_attachment.id, "thread_id": new_attachment.thread_id, "filename": new_attachment.filename, "markdown_content": new_attachment.markdown_content, "skeleton": new_attachment.skeleton})
    db.commit()

    return new_attachment.to_dict()

@router.get("/threads/{thread_id}/attachments")
def list_attachments(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    attachments = db.query(Attachment).filter(Attachment.thread_id == thread_id).order_by(Attachment.created_at.asc()).all()
    return [a.to_dict() for a in attachments]

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
                from app.agent import insert_paragraph, insert_table, insert_list, apply_style, read_markdown_section, search_document
                graph_tools = [mock_think, mock_search_kb, mock_check_entitlements, insert_paragraph, insert_table, insert_list, apply_style, read_markdown_section, search_document]
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
        
        from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
        
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

        # Check for mock command "all attachments"
        if payload.content.strip().lower() == "all attachments":
            attachments = db.query(Attachment).filter(Attachment.thread_id == thread_id).order_by(Attachment.created_at.asc()).all()
            mock_res = f"**All Attachments ({len(attachments)})**\n\n"
            for att in attachments:
                mock_res += f"### {att.filename}\n"
                mock_res += f"- **Length**: {len(att.markdown_content)} characters\n"
                mock_res += f"- **Preview**: {att.markdown_content[:500]}...\n\n"
            
            parts = []

            # Simulated reasoning step
            parts.append({'type': 'reasoning', 'text': 'Scanning conversation context for uploaded files...'})
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.2)
            
            # Simulated tool call
            mock_tool_call_id = f"mock_{uuid.uuid4().hex[:8]}"
            parts.append({'type': 'tool-call', 'toolCallId': mock_tool_call_id, 'toolName': 'search_document', 'args': {'query': '*'}, 'status': 'running'})
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.4)
            
            # Simulated tool call completion
            parts[-1] = {'type': 'tool-call', 'toolCallId': mock_tool_call_id, 'toolName': 'search_document', 'args': {'query': '*'}, 'status': 'complete', 'result': f'Found {len(attachments)} files'}
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.2)
            
            parts.append({"type": "text", "text": mock_res})
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            return

        # Inject attachment context if available
        attachments = db.query(Attachment).filter(Attachment.thread_id == thread_id).order_by(Attachment.created_at.asc()).all()
        if attachments:
            attachment_directives = []
            for att in attachments:
                attachment_directives.append(f"The user has uploaded a file: '{att.filename}' (ID: {att.id}). Summary: [{att.skeleton}]. You do NOT have the full text of this document in your context. If the user asks a question related to this file, you MUST use your tools (read_markdown_section or search_document) to navigate the Markdown headers or search the document before answering. Supply the file ID '{att.id}' to the tools.")
            system_msg = SystemMessage(content="\n\n".join(attachment_directives), id=f"sys_att_{thread_id}")
            state_messages.insert(0, system_msg)

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
import pycrdt
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
def get_document(thread_id: str, message_id: Optional[str] = None, fallback_parent_id: Optional[str] = None, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
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

    computed_snapshot = document.latest_snapshot
    
    # NEW BRANCH-AWARE RECONSTRUCTION LOGIC
    if message_id:
        target_msg = db.query(Message).filter(Message.id == message_id, Message.thread_id == thread_id).first()
        if not target_msg and fallback_parent_id:
            target_msg = db.query(Message).filter(Message.id == fallback_parent_id, Message.thread_id == thread_id).first()
        if target_msg:
            if target_msg.checkpoint_snapshot:
                computed_snapshot = target_msg.checkpoint_snapshot
            else:
                computed_snapshot = _reconstruct_snapshot(thread_id, target_msg, db, document.latest_snapshot)
                target_msg.checkpoint_snapshot = computed_snapshot
                db.commit()

    return JSONResponse(content={
        "default_theme_hash": default_template.theme_hash,
        "theme_hash": document.theme_hash or default_template.theme_hash,
        "numbering_json": num_dict,
        "latest_snapshot": base64.b64encode(computed_snapshot).decode('utf-8') if computed_snapshot else None
    })

@router.put("/threads/{thread_id}/document")
async def put_document(thread_id: str, request: Request, message_id: Optional[str] = None, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    # Verify thread exists and belongs to user
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    document = db.query(Document).filter(Document.thread_id == thread_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    try:
        delta = await request.body()
        with open("backend_debug.log", "a") as f:
            f.write(f"DEBUG: put_document called for thread {thread_id}, delta length: {len(delta) if delta else 0}\n")
        if not delta:
            return {"status": "success", "message": "No delta provided"}
            
        target_msg = None
        if message_id:
            target_msg = db.query(Message).filter(Message.id == message_id, Message.thread_id == thread_id).first()
        if not target_msg and fallback_parent_id:
            target_msg = db.query(Message).filter(Message.id == fallback_parent_id, Message.thread_id == thread_id).first()

        ydoc = pycrdt.Doc()
        
        # Apply to target message's checkpoint if specified
        if target_msg:
            if target_msg.checkpoint_snapshot:
                ydoc.apply_update(target_msg.checkpoint_snapshot)
                ydoc.apply_update(delta)
                target_msg.checkpoint_snapshot = ydoc.get_update()
            else:
                ydoc.apply_update(delta)
                target_msg.checkpoint_snapshot = ydoc.get_update()

        # Update global legacy snapshot as a fallback / main doc
        ydoc_global = pycrdt.Doc()
        if document.latest_snapshot:
            ydoc_global.apply_update(document.latest_snapshot)
        ydoc_global.apply_update(delta)
        document.latest_snapshot = ydoc_global.get_update()
        
        try:
            metadata_map = ydoc_global.get("metadata", type=pycrdt.Map)
            theme_hash = metadata_map.get("themeHash")
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
    with open("backend_debug.log", "a") as f:
        f.write(f"DEBUG: commit_turn called for thread {thread_id}, delta length: {len(delta) if delta else 0}\n")
    
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

    # 1. Fetch parent message if exists to inherit checkpoint_snapshot
    parent_msg = None
    if payload.parent_id:
        parent_msg = db.query(Message).filter(Message.id == payload.parent_id, Message.thread_id == thread_id).first()

    # 2. Compute user_message's checkpoint
    user_checkpoint = None
    if parent_msg:
        user_checkpoint = _reconstruct_snapshot(thread_id, parent_msg, db, document.latest_snapshot)
    elif document.latest_snapshot:
        user_checkpoint = document.latest_snapshot

    # 3. Save user message
    user_msg_content = [{"type": "text", "text": payload.user_content}]
    user_message = Message(
        id=payload.user_message_id,
        thread_id=thread_id,
        parent_id=payload.parent_id,
        role="user",
        content=json.dumps(user_msg_content),
        checkpoint_snapshot=user_checkpoint
    )
    db.add(user_message)
    
    # 4. Save assistant message
    assistant_checkpoint = user_checkpoint
    if delta:
        ydoc = pycrdt.Doc()
        if user_checkpoint:
            ydoc.apply_update(user_checkpoint)
        ydoc.apply_update(delta)
        assistant_checkpoint = ydoc.get_update()

        # Global document update (legacy tracking)
        document.latest_snapshot = assistant_checkpoint
        try:
            metadata_map = ydoc.get("metadata", type=pycrdt.Map)
            theme_hash = metadata_map.get("themeHash")
            if theme_hash:
                document.theme_hash = theme_hash
        except Exception as e:
            print("Failed to extract themeHash from delta in commit_turn:", e)

    assistant_message = Message(
        id=payload.assistant_message_id,
        thread_id=thread_id,
        parent_id=payload.user_message_id,
        role="assistant",
        content=json.dumps(payload.assistant_parts),
        delta_blob=delta if delta else None,
        checkpoint_snapshot=assistant_checkpoint
    )
    db.add(assistant_message)
            
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
                from app.agent import insert_paragraph, insert_table, insert_list, apply_style, read_markdown_section, search_document
                graph_tools = [mock_think, mock_search_kb, mock_check_entitlements, insert_paragraph, insert_table, insert_list, apply_style, read_markdown_section, search_document]
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
