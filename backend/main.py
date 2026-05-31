import json
import asyncio
import uuid
import base64
import hashlib
import os
from typing import List, Optional, Any
from fastapi import FastAPI, Depends, HTTPException, status, Body, Request, Header, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

import database
from database import get_db, Thread, Message
from agent import create_agent_graph

# Initialize database tables on startup
database.init_db()

app = FastAPI(title="APCOT Chat Backend")

# Helper to load config.json from root directory
def load_combined_config():
    config = {
        "BACKEND_PORT": 8080,
        "AUTHBLUE_PORT": 5001,
        "FRONTEND_PORT": 5173,
        "ENABLE_SSO": True
    }
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                for k, v in loaded.items():
                    config[k] = v
    except Exception as e:
        print("Failed to load root config.json in backend:", e)
    return config

root_config = load_combined_config()
frontend_port = root_config.get("FRONTEND_PORT", 5173)

# Load configure values for backend delays from nested MOCK_CONFIG with default fallbacks
mock_config = root_config.get("MOCK_CONFIG", {})
REASONING_STEP_DELAY = float(mock_config.get("REASONING_STEP_DELAY", 0.12))
TOOL_RUNNING_DELAY = float(mock_config.get("TOOL_RUNNING_DELAY", 0.4))
TOOL_COMPLETE_DELAY = float(mock_config.get("TOOL_COMPLETE_DELAY", 0.15))
TEXT_STREAM_DELAY = float(mock_config.get("TEXT_STREAM_DELAY", 0.018))

REGULAR_REASONING_DELAY = float(mock_config.get("REGULAR_REASONING_DELAY", 0.06))
REGULAR_TOOL_RUNNING_DELAY = float(mock_config.get("REGULAR_TOOL_RUNNING_DELAY", 0.3))
REGULAR_TOOL_COMPLETE_DELAY = float(mock_config.get("REGULAR_TOOL_COMPLETE_DELAY", 0.1))
REGULAR_TEXT_STREAM_DELAY = float(mock_config.get("REGULAR_TEXT_STREAM_DELAY", 0.015))


# Enable CORS for the local Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        f"http://localhost:{frontend_port}", f"http://127.0.0.1:{frontend_port}"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global setting: if True, missing auth raises 401. If False, falls back to "beyond_dev"
env_sso = os.environ.get("ENABLE_SSO")
if env_sso is not None:
    ENABLE_SSO = env_sso.lower() == "true"
else:
    ENABLE_SSO = bool(root_config.get("ENABLE_SSO", True))

# Global setting for streaming response (default is True)
ENABLE_STREAMING = bool(root_config.get("ENABLE_STREAMING", True))

# Global setting to toggle Mock LLM vs Production OpenAI (default is True)
mock_config = root_config.get("MOCK_CONFIG", {})
USE_MOCK_LLM = bool(mock_config.get("USE_MOCK_LLM", True))


def get_polymorphic_llm() -> Any:
    """Injects the appropriate LLM client dynamically based on config."""
    if USE_MOCK_LLM:
        try:
            from mock_showcase.mock_llm import MockChatModel
            return MockChatModel()
        except ImportError as e:
            print("Warning: MockChatModel file not found. Falling back to ChatOpenAI:", e)
            
    # Production path: OpenAI ChatModel via LangChain
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.1
    )


def get_current_user(
    request: Request,
    adsId: Optional[str] = Header(None, alias="adsId"),
    email: Optional[str] = Header(None, alias="email"),
    bluetoken: Optional[str] = Cookie(None)
):
    user_id = None
    user_email = None
    fullname = None
    firstname = None
    lastname = None
    employeeid = None

    # 1. Read case-insensitive request headers first (standard production behavior)
    headers = request.headers
    h_ads = headers.get("adsid") or headers.get("adsId") or headers.get("ADSID") or adsId
    h_email = headers.get("email") or headers.get("EMAIL") or email
    h_first = headers.get("firstname") or headers.get("FIRSTNAME")
    h_last = headers.get("lastname") or headers.get("LASTNAME")
    h_full = headers.get("fullname") or headers.get("FULLNAME")
    h_empid = headers.get("employeeid") or headers.get("EMPLOYEEID")

    if h_ads:
        user_id = h_ads
        user_email = h_email
        fullname = h_full or f"{h_first or ''} {h_last or ''}".strip()
        firstname = h_first
        lastname = h_last
        employeeid = h_empid
    elif h_email:
        user_id = h_email
        user_email = h_email
        fullname = h_full
        firstname = h_first
        lastname = h_last
        employeeid = h_empid

    # 2. Decode the `bluetoken` JWT cookie if headers are absent (local development simulator)
    if not user_id and bluetoken:
        try:
            parts = bluetoken.split(".")
            if len(parts) >= 2:
                payload_b64 = parts[1]
                payload_b64 += "=" * (4 - len(payload_b64) % 4)
                payload_bytes = base64.urlsafe_b64decode(payload_b64.encode('utf-8'))
                payload = json.loads(payload_bytes.decode('utf-8'))
                
                ads_id_val = payload.get("adsId") or payload.get("uid") or payload.get("sub")
                email_val = payload.get("email")
                
                if ads_id_val:
                    user_id = ads_id_val
                    user_email = email_val
                    fullname = payload.get("fullname")
                    firstname = payload.get("firstname")
                    lastname = payload.get("lastname")
                    employeeid = payload.get("employeeid")
                elif email_val:
                    user_id = email_val
                    user_email = email_val
                    fullname = payload.get("fullname")
                    firstname = payload.get("firstname")
                    lastname = payload.get("lastname")
                    employeeid = payload.get("employeeid")
        except Exception as e:
            print("JWT base64 decode error in backend:", e)

    # 3. Fallback when auth is completely missing
    if not user_id:
        if not ENABLE_SSO:
            return {
                "user_id": "beyond_dev",
                "email": "beyond.developer@aexp.com",
                "fullname": "Beyond Developer",
                "firstname": "Beyond",
                "lastname": "Developer",
                "employeeid": "9994321"
            }
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: No AuthBlue session or headers found"
        )

    return {
        "user_id": user_id,
        "email": user_email or f"{user_id}@aexp.com",
        "fullname": fullname or user_id.capitalize(),
        "firstname": firstname or user_id.capitalize(),
        "lastname": lastname or "",
        "employeeid": employeeid or "0000000"
    }

# Pydantic schemas for validation
class MessageCreate(BaseModel):
    id: Optional[str] = None
    parentId: Optional[str] = None
    assistantMessageId: Optional[str] = None
    content: str  # The raw input text from the composer

class ThreadCreate(BaseModel):
    title: Optional[str] = "New Chat"

# SSO User Info Endpoints
@app.get("/v1/user/userinfo")
def get_user_userinfo(current_user: dict = Depends(get_current_user)):
    return {
        "uid": current_user["user_id"],
        "firstname": current_user["firstname"],
        "lastname": current_user["lastname"],
        "fullname": current_user["fullname"],
        "email": current_user["email"],
        "employeeid": current_user["employeeid"],
        "GUID": hashlib.md5(current_user["user_id"].encode('utf-8')).hexdigest(),
        "udn": f"CN={current_user['fullname']},OU=FIMPortal,OU=AMEX,DC=ADS-SSO-1,DC=AEXP,DC=COM",
        "scope": {},
        "message": "success",
        "status": "success"
    }

@app.get("/api/user/me")
def get_api_user_me(current_user: dict = Depends(get_current_user)):
    return get_user_userinfo(current_user)

@app.get("/api/starter-prompts")
def get_starter_prompts(current_user: dict = Depends(get_current_user)):
    """Dedicated API endpoint to retrieve standard conversation starter prompts."""
    return [
        {
            "title": "Help & Guidelines",
            "prompt": "Can you list the guidelines in 'ui-project-bootstrap-guidelines.md'?"
        },
        {
            "title": "Knowledge Base Lookup",
            "prompt": "Search the knowledge base for APCOT Chat information"
        },
        {
            "title": "State Machine Demo",
            "prompt": "Show me a demo of your LangGraph thinking and tool executing cycles!"
        },
        {
            "title": "Aesthetics Showcase",
            "prompt": "Explain how your dark mode glassmorphic UI is styled without Tailwind CSS"
        }
    ]

# CRUD API Routes
@app.get("/api/threads")
def list_threads(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    threads = db.query(Thread).filter(Thread.user_id == current_user["user_id"]).order_by(Thread.created_at.desc()).all()
    return [t.to_dict() for t in threads]

@app.post("/api/threads")
def create_thread(data: ThreadCreate, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    new_thread = Thread(title=data.title, user_id=current_user["user_id"])
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)
    return new_thread.to_dict()

@app.delete("/api/threads/{thread_id}")
def delete_thread(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    db.delete(thread)
    db.commit()
    return {"status": "success", "message": f"Thread {thread_id} deleted"}

@app.get("/api/threads/{thread_id}/messages")
def list_messages(thread_id: str, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == current_user["user_id"]).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    messages = db.query(Message).filter(Message.thread_id == thread_id).order_by(Message.created_at.asc()).all()
    return [m.to_dict() for m in messages]

@app.post("/api/threads/{thread_id}/messages")
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
                from mock_showcase.mock_tools import think as mock_think, search_kb as mock_search_kb, check_entitlements as mock_check_entitlements
                graph_tools = [mock_think, mock_search_kb, mock_check_entitlements]
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

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", root_config["BACKEND_PORT"]))
    print(f"Starting APCOT Chat Backend on port {port}...")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
