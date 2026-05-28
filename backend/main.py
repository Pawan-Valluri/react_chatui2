import json
import asyncio
import uuid
import base64
import hashlib
import os
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, Body, Request, Header, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

import database
from database import get_db, Thread, Message
from agent import agent_graph

# Initialize database tables on startup
database.init_db()

app = FastAPI(title="APCOT Chat Backend")

# Enable CORS for the local Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global setting: if "true", missing auth raises 401. If "false", falls back to "beyond_dev"
ENABLE_SSO = os.environ.get("ENABLE_SSO", "true").lower() == "true"

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
        # Check if the prompt triggers the multi-step search showcase
        input_lower = payload.content.lower()
        is_multi_step = any(kw in input_lower for kw in ["multi", "multiple", "advanced", "complex", "step"])

        parts = []

        if is_multi_step:
            # ─── SHOWCASE: MULTI-STEP THINKING & MULTIPLE TOOL USE ───
            
            # Step 1: Thought 1
            thought1 = [
                "Initializing advanced multi-step search pipeline...",
                "Searching the primary Knowledge Base for 'APCOT Chat' baseline architecture...",
                "Retrieving local framework specifications for @assistant-ui/react..."
            ]
            parts.append({"type": "reasoning", "text": ""})
            accumulated = ""
            for step in thought1:
                if accumulated:
                    accumulated += "\n"
                accumulated += step
                parts[0]["text"] = accumulated
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.12)

            # Step 2: Tool 1 (Running)
            t1_info = {
                "type": "tool-call",
                "toolCallId": "tc_kb_search_1",
                "toolName": "search_kb",
                "args": {"query": "APCOT Chat framework architecture"},
                "status": "running"
            }
            parts.append(t1_info)
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.4)

            # Step 2: Tool 1 (Complete)
            parts[1]["status"] = "complete"
            parts[1]["result"] = (
                "SUCCESS: Found Knowledge Base specs for 'APCOT Chat'. "
                "Core: React, Vite, TypeScript. UI primitives: @assistant-ui/react. "
                "Styling: Pure Vanilla CSS with smooth collapsing transitions."
            )
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.15)

            # Step 3: Thought 2
            thought2 = [
                "Baseline specifications retrieved successfully.",
                "Now querying corporate Entitlements Repository to check group policy constraints...",
                "Verifying active SSO permissions for Charles Frost (ADs ID: cfrost)..."
            ]
            parts.append({"type": "reasoning", "text": ""})
            accumulated = ""
            for step in thought2:
                if accumulated:
                    accumulated += "\n"
                accumulated += step
                parts[2]["text"] = accumulated
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.12)

            # Step 4: Tool 2 (Running)
            t2_info = {
                "type": "tool-call",
                "toolCallId": "tc_entitlements_check_2",
                "toolName": "check_entitlements",
                "args": {"adsId": current_user["user_id"], "resource": "APCOT Chat"},
                "status": "running"
            }
            parts.append(t2_info)
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.4)

            # Step 4: Tool 2 (Complete)
            parts[3]["status"] = "complete"
            parts[3]["result"] = (
                f"AUTHORIZED: User '{current_user['user_id']}' is a member of 'SSO_APP_ADMIN'. "
                "Granted full administration, thread deletion, and query permissions."
            )
            yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
            await asyncio.sleep(0.15)

            # Step 5: Thought 3
            thought3 = [
                "Group membership and SSO permissions verified.",
                "Formulating final consolidated response including architectural specs and entitlement access status..."
            ]
            parts.append({"type": "reasoning", "text": ""})
            accumulated = ""
            for step in thought3:
                if accumulated:
                    accumulated += "\n"
                accumulated += step
                parts[4]["text"] = accumulated
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.12)

            # Step 6: Text response typewriter stream
            response_text = (
                f"Hello {current_user['fullname']}! I have executed an advanced multi-step "
                "reasoning trace and triggered two local tools on your behalf:\n\n"
                "1. **`search_kb`**: Retrieved the system design documents confirming APCOT Chat's "
                "vanilla CSS layout and assistant primitives.\n"
                "2. **`check_entitlements`**: Verified that your ADs ID (**`" + current_user['user_id'] + "`**) "
                "is registered with **`SSO_APP_ADMIN`** corporate groups, granting you full administrative "
                "permissions over this workspace.\n\n"
                "The system is fully operational and securely integrated with your AuthBlue profile. "
                "Let me know what you'd like to build next!"
            )
            parts.append({"type": "text", "text": ""})
            words = response_text.split(" ")
            current_text = ""
            for word in words:
                if current_text:
                    current_text += " "
                current_text += word
                parts[5]["text"] = current_text
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.018)

        else:
            # ─── REGULAR FLOW: 1 THINKING STEP, OPTIONAL 1 TOOL ───
            state = {
                "input_text": payload.content,
                "reasoning_steps": [],
                "tool_calls": [],
                "response_text": "",
                "current_node": ""
            }
            
            # --- NODE 1: THINKING ---
            state = await agent_graph.ainvoke(state)
            parts.append({"type": "reasoning", "text": ""})
            accumulated = ""
            for step in state["reasoning_steps"]:
                if accumulated:
                    accumulated += "\n"
                accumulated += step
                parts[0]["text"] = accumulated
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.06)

            # --- NODE 2: TOOL ---
            state = await agent_graph.ainvoke(state)
            if state["tool_calls"]:
                tc = state["tool_calls"][0]
                t_info = {
                    "type": "tool-call",
                    "toolCallId": tc["toolCallId"],
                    "toolName": tc["toolName"],
                    "args": tc["args"],
                    "status": "running"
                }
                parts.append(t_info)
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.3)
                
                parts[1]["status"] = "complete"
                parts[1]["result"] = tc["result"]
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.1)

            # --- NODE 3: GENERATION ---
            state = await agent_graph.ainvoke(state)
            response_text = state["response_text"]
            
            parts.append({"type": "text", "text": ""})
            text_idx = len(parts) - 1
            words = response_text.split(" ")
            current_text = ""
            for word in words:
                if current_text:
                    current_text += " "
                current_text += word
                parts[text_idx]["text"] = current_text
                yield f"event: parts\ndata: {json.dumps(parts)}\n\n"
                await asyncio.sleep(0.015)

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
