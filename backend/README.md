# APCOT Chat Backend API Server

A high-performance **FastAPI** server that persists threads, isolates user data, and implements a multi-step **LangGraph** workflow that streams reasoning traces and tool executions to the client.

---

## 🔒 Session Identification & Conversational Isolation

To support secure enterprise multi-tenancy in both production and development environments, the server implements a dynamic, case-insensitive authentication dependency (`get_current_user` in `main.py`):

1. **Proxy Headers (Production)**: The server scans incoming requests for enterprise gateway headers case-insensitively (`adsId`, `adsid`, `email`, `employeeid`).
2. **Signed JWT Cookie (Local Dev SSO)**: If headers are missing, it decodes the `bluetoken` JWT cookie issued by the AuthBlue simulator, verifying the payload.
3. **Graceful Fallback**: If `ENABLE_SSO` is set to `false`, the server bypasses authorization checks and initializes a local offline developer profile (`beyond_dev`).

### User-Scoped Database Isolation
Every database model (SQLite/SQLAlchemy) is associated with an authenticated user identity:
- Thread creation automatically tags rows with the active user's `user_id`.
- The list and message retrieval API routes enforce rigorous `WHERE user_id = :active_user` filters, completely isolating user data from other sessions.

---

## 💾 SQLite Database Auto-Migration

The database (`backend/database.py`) operates dynamically on top of SQLAlchemy:
- **Zero-Downtime Migration**: On startup, `init_db()` inspects the existing SQLite database columns. If the `threads` table is missing the `user_id` column (e.g. legacy data), it executes a safe, dynamic `ALTER TABLE threads ADD COLUMN user_id VARCHAR` migration on-the-fly, preserving existing tables without data loss.

---

## 🧠 LangGraph State Machine & SSE Streaming

Conversational turns are represented as a state graph compiled using **LangGraph** (`backend/agent.py`):

```text
    [START] ──> [Thinking Node] ──> [Tool Node] ──> [Generation Node] ──> [END]
```

- **Thinking Node**: Analyzes prompt guidelines and outputs thought traces.
- **Tool Node**: Triggers local Python handlers (e.g. mock knowledge base lookups) and registers arguments and structured outcomes.
- **Generation Node**: Formulates the final conversational text reply.

### Server-Sent Events (SSE) Streaming
The backend pipes LangGraph state changes to the client as high-performance Server-Sent Events (`media_type="text/event-stream"`). 
It streams a JSON-serialized array of **`MessagePart`** objects:
- `reasoning`: live thinking step segments.
- `tool-call` & `tool-response`: active tool states (running, arguments, results).
- `text`: the typewriter-effect typewriter stream of the final reply.

---

## 🚀 Independent Execution

Make sure you have installed standard backend dependencies inside your Python environment:
```bash
# Inside the backend folder
pip install -r requirements.txt

# Run the API server on port 8080
python -m uvicorn main:app --port 8080 --reload
```
