# APCOT Chat: State & Thread Architecture Reference

> **Audience:** AI agents making modifications to thread management, document state, Y.js sync, attachments, or the LangGraph pipeline. Read every section relevant to your modification before writing code.

---

## Table of Contents

1. [Overview — Two Parallel State Machines](#1-overview)
2. [Database Schema](#2-database-schema)
3. [Thread Lifecycle](#3-thread-lifecycle)
4. [Message Model & Content Parts](#4-message-model--content-parts)
5. [LangGraph State Machine](#5-langgraph-state-machine)
6. [LangGraph Checkpointing (langgraph_checkpoints.db)](#6-langgraph-checkpointing)
7. [Document State & Y.js CRDT](#7-document-state--yjs-crdt)
8. [DocumentPool (Frontend In-Memory LRU)](#8-documentpool)
9. [TemplateCache (IndexedDB)](#9-templatecache)
10. [Commit Protocol — The Dual-Delta Flow](#10-commit-protocol)
11. [Attachments Pipeline](#11-attachments-pipeline)
12. [SSE Streaming Protocol](#12-sse-streaming-protocol)
13. [Frontend ↔ Backend Event Bus](#13-frontend--backend-event-bus)
14. [Message History Reconstruction for LangGraph](#14-message-history-reconstruction-for-langgraph)
15. [Thread Title Auto-Naming](#15-thread-title-auto-naming)
16. [LangGraph Interrupt / Resume Flow](#16-langgraph-interrupt--resume-flow)
17. [Key Invariants & Gotchas](#17-key-invariants--gotchas)

---

## 1. Overview

APCOT Chat runs **two independent, coupled state machines in parallel**:

```
┌──────────────────────────────────────────────────────────┐
│               PARALLEL STATE MACHINES                    │
│                                                          │
│   ┌─────────────────────┐   ┌────────────────────────┐  │
│   │  LangGraph / Agent  │   │   Document / Y.js CRDT │  │
│   │  (conversation)     │   │   (workspace document) │  │
│   │                     │   │                        │  │
│   │  Messages ──────────►   │  Y.Doc ────────────────►  │
│   │  Checkpoints         │   │  latest_snapshot (DB)  │  │
│   │  Tool calls          │   │  delta_blob per msg    │  │
│   └──────────┬──────────┘   └──────────┬─────────────┘  │
│              │                          │                │
│              └────── /commit ───────────┘                │
└──────────────────────────────────────────────────────────┘
```

Both are **bound to the same `thread_id`**. They are decoupled during streaming and synchronized atomically via the `/commit` endpoint at the end of each turn.

---

## 2. Database Schema

File: `backend/database.py`  
Database: `apcot_chat.db` (SQLite)

### Tables

#### `threads`
| Column | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `title` | String | Defaults to `"New Chat"`. Auto-set to first 6 words of first user message on commit. |
| `user_id` | String | FK to AuthBlue user session. Threads are strictly user-scoped. |
| `created_at` | DateTime | — |

> **CASCADE:** Deleting a thread cascades to `messages`, `documents`, and `attachments`.

#### `documents`
One document per thread (1:1 relationship).

| Column | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `thread_id` | String | FK → `threads.id` (CASCADE) |
| `template_id` | String | FK → `templates.id`. The template used to bootstrap the docx editor. |
| `theme_hash` | String | SHA-256 of the docx template binary. Used as a cache key for IndexedDB. |
| `latest_snapshot` | LargeBinary (BLOB) | The merged Y.js state vector. Updated on every `PUT /document` and every `/commit`. This is the ground truth for the document state. |

> **Critical:** `latest_snapshot` is a raw Y.js binary update (created by `Y.encodeStateAsUpdate()`). Do not treat it as a docx or JSON blob.

#### `messages`
| Column | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK. Frontend-generated so branching works correctly. |
| `thread_id` | String | FK → `threads.id` (CASCADE) |
| `parent_id` | String | FK → `messages.id`. Forms a linked-list tree for message branching. `null` for the first message. |
| `role` | String | `"user"` or `"assistant"` |
| `content` | Text | JSON-encoded array of **message parts** (see §4). |
| `delta_blob` | LargeBinary | Y.js delta applied to the document by this assistant turn. Stored for future replay/rollback. |
| `checkpoint_snapshot` | LargeBinary | Reserved for per-message document snapshots. Not actively used yet. |

#### `attachments`
| Column | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `thread_id` | String | FK → `threads.id` (CASCADE). Attachments are thread-scoped and deleted with the thread. |
| `filename` | String | Original uploaded filename. |
| `markdown_content` | Text | Full markdown extracted via `markitdown`. |
| `skeleton` | Text | LLM-generated 150-200 word summary + Table of Contents. Injected into the LangGraph SystemMessage. |

#### `templates`
| Column | Type | Notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `version_name` | String | Human readable name. |
| `docx_blob` | LargeBinary | Raw `.docx` binary. Served at `GET /api/templates/{theme_hash}`. |
| `styles_json` | Text | Extracted ProseMirror style definitions. |
| `theme_hash` | String | SHA-256 of `docx_blob`. Indexed. Used as immutable cache key. |
| `numbering_json` | Text | Parsed `word/numbering.xml` structure for list rendering. |

#### `attachments_fts` (Virtual)
SQLite FTS5 virtual table. Created at startup in `init_db()`. Mirrors `attachments` for full-text search.

```sql
CREATE VIRTUAL TABLE attachments_fts USING fts5(
    id UNINDEXED,
    thread_id UNINDEXED,
    filename,
    markdown_content,
    skeleton,
    content="attachments",
    content_rowid="rowid"
)
```

Used by the `search_document` LangGraph tool. The `snippet()` function returns highlighted snippets.

---

## 3. Thread Lifecycle

```
Frontend: handleCreateThread()
    │
    ▼
POST /api/threads  {title: "New Chat", user_id: <from session>}
    │
    ▼
DB: Thread row created (title="New Chat")
    │
    ▼
GET /api/threads/{thread_id}/document  (first access auto-creates Document row)
    │
    ▼
[User sends first message]
    │
    ▼
POST /api/threads/{thread_id}/messages  → LangGraph runs → SSE stream
    │
    ▼
[Stream ends]  → StreamComplete event fired on window
    │
    ▼
POST /api/threads/{thread_id}/commit  {metadata + Y.js delta}
    │
    ├── thread.title updated to first 6 words of user message (if still "New Chat")
    ├── user Message row saved
    ├── assistant Message row saved (with content parts + delta_blob)
    └── document.latest_snapshot updated
    │
    ▼
Frontend: fetchThreads() called 600ms later → sidebar/title reflect new title
```

### Thread Deletion

```
DELETE /api/threads/{thread_id}
```
SQLAlchemy CASCADE deletes: `messages`, `documents`, `attachments`. The LangGraph checkpoint for that thread ID in `langgraph_checkpoints.db` is **not** automatically cleaned up (orphaned rows remain in the SQLite checkpoint DB).

---

## 4. Message Model & Content Parts

Messages are **not stored as raw text**. `content` is always a JSON-encoded array of **part objects**. Each part has a `type` field.

### Part Types

| `type` | Description | Fields |
|---|---|---|
| `"text"` | Final assistant text response | `text: string` |
| `"reasoning"` | A single `think` tool call thought | `text: string` |
| `"tool-call"` | A tool invocation with its result | `toolCallId, toolName, args, status ("running"/"complete"), result?` |

### Example — stored `content` for an assistant message:
```json
[
  { "type": "reasoning", "text": "The user wants to insert a paragraph." },
  {
    "type": "tool-call",
    "toolCallId": "tc_abc123",
    "toolName": "insert_paragraph",
    "args": { "style": "Title", "text": "Hello World" },
    "status": "complete",
    "result": "Success"
  },
  { "type": "text", "text": "I've added the title paragraph to your document." }
]
```

### Example — stored `content` for a user message:
```json
[{ "type": "text", "text": "Add a title paragraph that says Hello World" }]
```

> **Key rule:** The `content` array is accumulated incrementally during streaming. The final array is what is sent to `/commit` as `assistant_parts`. This exact array is stored in the DB and later used to reconstruct LangGraph history.

---

## 5. LangGraph State Machine

File: `backend/app/agent.py`

### AgentState TypedDict

```python
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]  # Full message history
    reasoning_steps: List[str]   # All think() thoughts accumulated this turn
    loop_counter: int            # Safety guardrail. Hard cap at 12 iterations.
```

### Nodes

```
START
  │
  ▼
agent_node  ──────────────────────────────────────────────────────┐
  │                                                               │
  ▼ (evaluate_agent_step)                                        │
  ├── no tool_calls → END                                        │
  ├── think() call → loops back to ──────────────────────────────┘
  ├── remote client tool (insert_paragraph etc.) → client_tool_node
  └── native tool (search_kb, read_markdown_section etc.) → ToolNode
        │
        ▼
      tools node (ToolNode) → loops back to agent_node
        │
      client_tool_node → LangGraph interrupt() → agent_node (after resume)
```

### Tool Categories

#### Native Server-Side Tools
Executed in-process on the backend. Results are ToolMessages fed back to LangGraph.
- `think(thought)` — virtual "thinking" loop. Never shown as a tool call in UI.
- `search_kb(query)` — static knowledge base stub.
- `check_entitlements(resource)` — static authorization stub.
- `read_markdown_section(file_id, heading_name)` — reads a markdown section from `attachments` table by heading.
- `search_document(file_id, query)` — FTS5 full-text search against `attachments_fts`.

#### Remote Client-Side Tools (require `interrupt()`)
Executed in the browser against the ProseMirror editor. LangGraph pauses execution via `interrupt()`, the frontend executes the tool, then POSTs results to `/resume`.
- `insert_paragraph(style, text, position?)`
- `insert_table(name, rows, cols)`
- `insert_list(style, items)`
- `apply_style(selection, style)`

### Loop Guardrail

`loop_counter` increments on every `agent_node` call. At `>= 12`, `evaluate_agent_step` returns `END` regardless of tool calls. This prevents infinite billing loops on runaway LLM behavior.

---

## 6. LangGraph Checkpointing

File: `langgraph_checkpoints.db` (SQLite, in backend working directory)

LangGraph uses `AsyncSqliteSaver` as its checkpointer. Every `astream()` call writes graph state (messages, reasoning_steps, loop_counter) to this DB, keyed by `thread_id`.

```python
async with AsyncSqliteSaver.from_conn_string("langgraph_checkpoints.db") as memory:
    agent_graph = create_agent_graph(llm, tools=graph_tools, checkpointer=memory)
    config = {"configurable": {"thread_id": thread_id}}
    async for update in agent_graph.astream(state, config, stream_mode="updates"):
        ...
```

### Why two databases?

| DB | Purpose |
|---|---|
| `apcot_chat.db` | Permanent application state: threads, messages, documents, attachments |
| `langgraph_checkpoints.db` | Transient LangGraph execution state. Required for `interrupt()`/`Command(resume=...)` to work across HTTP requests. |

> **Important:** The `/resume` endpoint reads the checkpoint with `aget_state(config)` to get the suspended graph state, then continues with `astream(Command(resume=...), config)`. The thread_id is the join key between both databases.

### State is Rebuilt Each Turn

Every call to `send_message` constructs a **fresh state** from the DB message history (see §14) rather than reading it from the checkpoint. The checkpoint is only used for in-flight interrupted states (client tool executions).

---

## 7. Document State & Y.js CRDT

The document workspace is a ProseMirror editor wrapped in a paged layout engine. Its state is managed as a [Y.js](https://yjs.dev) CRDT (`Y.Doc`).

### The Y.Doc Structure

The `Y.Doc` has two shared types:

| Key | Type | Content |
|---|---|---|
| `"prosemirror"` | `Y.XmlFragment` | The full ProseMirror document tree. Synced to the editor via `y-prosemirror`. |
| `"metadata"` | `Y.Map` | Holds `themeHash` (string). Used to bind the document to its `.docx` template. |

### How Document State Flows

```
Browser (Y.Doc in memory)
    │  Y.encodeStateAsUpdate(yDoc, localSnapshot)
    ▼
delta: Uint8Array  (only the changes since last save)
    │
    ├─── PUT /api/threads/{id}/document  (auto-save, debounced 5s)
    │
    └─── POST /api/threads/{id}/commit  (end-of-turn commit, body = delta)
              │
              ▼
         Backend: pycrdt
              │  ydoc = Doc()
              │  ydoc.apply_update(document.latest_snapshot)
              │  ydoc.apply_update(delta)
              │  document.latest_snapshot = ydoc.get_update()
              ▼
         DB: documents.latest_snapshot updated
```

### Loading on Thread Switch

```
GET /api/threads/{id}/document
    │  returns {latest_snapshot: base64, theme_hash, numbering_json}
    ▼
Frontend: DocumentPool.getDoc(threadId)  → Y.Doc (from LRU cache or new)
    │  Y.applyUpdate(yDoc, snapBytes)
    ▼
yDoc is hydrated. localSnapshotRef = Y.encodeStateVector(yDoc)
    │
    ▼
TemplateCache.get(themeHash)  → IndexedDB lookup
    │  if miss: fetch /api/templates/{themeHash} → cache → return
    ▼
documentBuffer: ArrayBuffer  → passed to DocxEditorWrapper → paged editor boots
```

### Guard States (useDocumentSync)

The loading sequence uses explicit guard states to prevent race conditions:

| State | Meaning |
|---|---|
| `FETCHING_SNAPSHOT` | Waiting for `/document` API response |
| `HYDRATING_STATE` | Applying snapshot bytes to Y.Doc via `Y.applyUpdate` |
| `RESOLVING_THEME` | Reading `themeHash` from Y.Doc metadata, fetching template |
| `READY` | Editor is fully mounted and synced |
| `ERROR` | Fatal error during any step above |

### Empty Document Seeding

When `latest_snapshot` is `null` (brand new thread), the Y.Doc is flagged:

```ts
(currentYDoc as any)._needsSeeding = true;
```

On first editor interaction (`handleLocalChange`), `seedYDocIfEmpty()` copies the current ProseMirror state into the Y.Doc's `"prosemirror"` XmlFragment. This is the bootstrap moment.

---

## 8. DocumentPool

File: `frontend/src/app/components/DocumentWorkspace/sync/DocumentPool.ts`

An in-memory LRU cache of `Y.Doc` instances, keyed by `thread_id`.

```typescript
class DocumentPool {
  private static MAX_DOCS = 5;          // Max live Y.Doc instances
  private static docs: Map<string, Y.Doc>;
  private static order: string[];       // LRU eviction order

  static getDoc(documentId: string): Y.Doc  // Returns existing or creates new
  static clearDoc(documentId: string)
}
```

**Why it exists:** Switching between threads must not re-allocate a Y.Doc that already has local unsaved changes. The pool ensures the same instance is reused for the same thread within a session.

**Eviction:** When 6th thread is accessed, the oldest thread's Y.Doc is garbage-collected from the map. Any unsaved changes in that Y.Doc are lost (the DB `latest_snapshot` remains as the last good state).

**Key:** The pool uses `thread_id` as the key, not `document_id`. This means one pool slot = one thread = one document.

---

## 9. TemplateCache

File: `frontend/src/app/components/DocumentWorkspace/sync/TemplateCache.ts`

Persists `.docx` template binaries in **IndexedDB** (`PrismTemplateCache` database, `templates` object store).

```typescript
class TemplateCache {
  static async get(themeHash: string): Promise<ArrayBuffer | null>
  static async set(themeHash: string, docxBlob: ArrayBuffer): Promise<void>
}
```

The cache key is `themeHash` (SHA-256 of the `.docx` binary). Since templates are immutable (same hash = same bytes), the `Cache-Control: public, max-age=31536000, immutable` header is set on `GET /api/templates/{theme_hash}`.

**Fallback:** If IndexedDB is unavailable, `get()` returns `null` and the template is fetched from the network on every load.

---

## 10. Commit Protocol — The Dual-Delta Flow

The commit is the most complex operation. It atomically saves the message turn AND the document changes in one HTTP request.

### Trigger

When the SSE stream ends (`reader.read()` returns `{ done: true }`), `ChatModelAdapter.ts` dispatches:

```javascript
window.dispatchEvent(new CustomEvent("StreamComplete", {
  detail: { userMessageId, parentId, userContent, assistantMessageId, assistantParts }
}));
```

### Handler (`useDocumentSync.ts` → `handleStreamComplete`)

```typescript
const delta = Y.encodeStateAsUpdate(yDocRef.current, localSnapshotRef.current);
// delta = binary diff between current YDoc state and state at last save point

await fetch(`/api/threads/${threadId}/commit`, {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-Commit-Metadata": JSON.stringify({
      user_message_id, parent_id, user_content,
      assistant_message_id, assistant_parts   // ← the full content parts array
    })
  },
  body: delta   // ← raw Y.js binary delta as request body
});
```

### Backend Handler (`POST /api/threads/{thread_id}/commit`)

1. **Parse** `X-Commit-Metadata` header → `CommitPayload`
2. **Auto-title**: if `thread.title == "New Chat"`, set to first 6 words of `user_content`
3. **Save user message**: `Message(role="user", content=JSON([{type:text, text:user_content}]))`
4. **Save assistant message**: `Message(role="assistant", content=JSON(assistant_parts), delta_blob=delta)`
5. **Merge Y.js delta into document snapshot**:
   ```python
   ydoc = pycrdt.Doc()
   ydoc.apply_update(document.latest_snapshot)  # current ground truth
   ydoc.apply_update(delta)                     # apply this turn's changes
   document.latest_snapshot = ydoc.get_update() # new ground truth
   ```
6. **Extract `themeHash`** from Y.Doc metadata map (if the template was changed)
7. **Commit all** in a single `db.commit()`

### Pre-Commit Document Save

Before the message POST begins, `ChatModelAdapter` dispatches `RequestSaveDocument`:

```javascript
window.dispatchEvent(new CustomEvent("RequestSaveDocument"));
await new Promise(resolve => setTimeout(resolve, 800));  // 800ms grace period
```

This forces any pending debounced auto-saves to flush immediately before the LangGraph graph runs. This ensures the `latest_snapshot` is current before the agent starts modifying the document.

---

## 11. Attachments Pipeline

Files: `backend/app/routers/threads.py`, `backend/app/agent.py`, `backend/database.py`

### Upload Flow

```
POST /api/threads/{thread_id}/attachments  (multipart/form-data, file field)
    │
    ▼
1. Write file to /tmp/<uuid>.<ext>
    │
    ▼
2. markitdown.convert(tmp_path) → markdown_text: str
    │  Supports: PDF, DOCX, XLSX, PPTX, HTML, images, etc.
    ▼
3. LLM.invoke(summarize_prompt) → skeleton: str
    │  skeleton = 150-200 word summary + Table of Contents
    ▼
4. DB: Attachment row inserted
    │
    ▼
5. FTS: INSERT INTO attachments_fts (for full-text search)
    │
    ▼
6. Return Attachment.to_dict()  (no markdown_content — only skeleton is returned)
```

### Context Injection

On every `send_message` call, the backend checks for attachments and prepends a `SystemMessage`:

```python
attachments = db.query(Attachment).filter(Attachment.thread_id == thread_id).all()
if attachments:
    directives = []
    for att in attachments:
        directives.append(
            f"The user has uploaded a file: '{att.filename}' (ID: {att.id}). "
            f"Summary: [{att.skeleton}]. You do NOT have the full text of this document "
            f"in your context. If the user asks a question related to this file, you MUST "
            f"use your tools (read_markdown_section or search_document) to navigate the "
            f"Markdown headers or search the document before answering."
        )
    system_msg = SystemMessage(content="\n\n".join(directives), id=f"sys_att_{thread_id}")
    state_messages.insert(0, system_msg)  # prepended before all history
```

**Important:** The full `markdown_content` is **never** loaded into LLM context. The agent must use tools to retrieve specific sections. This is by design to avoid context bloat with large documents.

### Agent Tools for Attachments

#### `read_markdown_section(file_id, heading_name)`
- Opens a fresh SQLAlchemy engine connection to `apcot_chat.db`
- Retrieves `markdown_content` for `file_id`
- Parses markdown headers, extracts text under the requested heading
- Returns up to 2000 characters

#### `search_document(file_id, query)`
- Runs `SELECT snippet(...) FROM attachments_fts WHERE attachments_fts MATCH :q AND id = :id`
- FTS5 `snippet()` returns highlighted context windows with `>>match<<` markers
- Falls back to simple `LIKE` substring search if FTS fails
- Returns up to 3 snippet results

### Cascade Deletion

When a thread is deleted, all its attachments are deleted via SQLAlchemy `CASCADE`. The FTS table is a `content=` FTS5 table pointing to the `attachments` table, so orphaned FTS rows may remain. On startup, `init_db()` re-syncs the FTS table.

---

## 12. SSE Streaming Protocol

The backend streams responses as [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events).

### Wire Format

```
event: <event_name>
data: <json_payload>

```
(blank line terminates each event)

### Event Types

| Event | Payload | When |
|---|---|---|
| `parts` | `Array<Part>` (full accumulated parts array) | On every LangGraph update (reasoning step, tool call, text delta) |
| `requires_action` | `{status: "requires_action", tool_calls: [...]}` | When LangGraph hits `client_tool_node` → `interrupt()` |
| `error` | `string` | On unexpected backend error |

### Parts Array Protocol

The `parts` array is **always the complete current state**, not a delta. Each `event: parts` emission replaces the previous one on the client. This is critical:

```
// Bad: sending partial updates
event: parts
data: [{"type": "reasoning", "text": "thinking..."}]

event: parts
data: [{"type": "tool-call", ...}]   ← client shows ONLY tool-call, no reasoning

// Correct: always send full accumulated array
event: parts
data: [{"type": "reasoning", "text": "thinking..."}, {"type": "tool-call", ...}]
```

The backend accumulates `rebuilt_parts` in memory and re-emits the full array on every LangGraph node completion.

### Client Parsing (`ChatModelAdapter.ts`)

```typescript
// Simplified
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
for (const line of lines) {
  if (line.startsWith("event: ")) currentEvent = line.substring(7);
  else if (line.startsWith("data: ")) {
    if (currentEvent === "parts") {
      yield { id: assistantMsgIdToYield, content: JSON.parse(data) };
    }
    if (currentEvent === "requires_action") {
      // execute client tools, POST to /resume, swap reader
    }
  }
}
```

---

## 13. Frontend ↔ Backend Event Bus

`useDocumentSync.ts` listens to `window` custom events to coordinate between the chat adapter and the document sync layer. These are **not** React state — they are imperative coordination signals.

| Event | Direction | Fired by | Handled by | Purpose |
|---|---|---|---|---|
| `RequestSaveDocument` | → | `ChatModelAdapter` | `useDocumentSync` | Flush pending auto-saves before a new LangGraph run starts |
| `DocumentSaved` | ← | `useDocumentSync` | (future use) | Confirms save is complete |
| `StreamComplete` | → | `ChatModelAdapter` | `useDocumentSync` | Triggers `/commit` with Y.js delta + message metadata |
| `RollbackFrontendEdits` | → | (error handlers) | `useDocumentSync` | Re-fetch document from DB to undo uncommitted changes |

---

## 14. Message History Reconstruction for LangGraph

Every `send_message` call **does not use** the LangGraph checkpoint for history. Instead it rebuilds history from the SQL `messages` table, traversing the `parent_id` linked list.

### Why Not Use Checkpoints?

Checkpoints store raw `BaseMessage` objects. Because users can edit previous messages and branch conversations, the DB parent-pointer tree is the canonical source of truth for what the "active branch" looks like.

### Reconstruction Algorithm

```python
# Start from user_message.parent_id
curr_parent_id = user_message.parent_id
while curr_parent_id and curr_parent_id in msg_map:
    ancestors.append(msg_map[curr_parent_id])
    curr_parent_id = msg_map[curr_parent_id].parent_id

ancestors.reverse()  # oldest → newest
```

Then each message's `content` parts array is translated back to LangChain message types:

| Part type | → LangChain type |
|---|---|
| User message | `HumanMessage(content=text, id=msg.id)` |
| `"reasoning"` part | Synthetic `think` tool call in an `AIMessage` |
| `"tool-call"` part | `AIMessage(tool_calls=[...])` + `ToolMessage(content=result)` |
| `"text"` part | `AIMessage(content=text)` |

If attachments exist for the thread, a `SystemMessage` is prepended to `state_messages` before all history.

---

## 15. Thread Title Auto-Naming

Title auto-naming happens **only in `/commit`**, not during streaming. The backend checks:

```python
if thread.title == "New Chat":
    words = payload.user_content.split()
    title_str = " ".join(words[:6])
    if len(words) > 6:
        title_str += "..."
    thread.title = title_str
```

**Why not in `/messages`?** The thread title must be persisted atomically with the message save. The `/commit` endpoint is the only place where both happen in one `db.commit()`.

**Frontend timing:** `onThreadUpdated()` (which calls `fetchThreads()`) is called 600ms after `StreamComplete`, giving the `/commit` request time to complete before the sidebar re-fetches.

---

## 16. LangGraph Interrupt / Resume Flow

Used for **client-side tools** (ProseMirror editor operations).

```
LangGraph runs → hits client_tool_node
    │
    ▼
interrupt({"status": "requires_action", "tool_calls": [...]})
    │  LangGraph saves full state to langgraph_checkpoints.db
    ▼
FastAPI yields:  event: requires_action\ndata: {...}\n\n
    │
    ▼
ChatModelAdapter detects "requires_action"
    │
    ▼
EditorBridge.executeToolCall(name, args)  ← mutates ProseMirror doc
    │
    ▼
POST /api/threads/{thread_id}/messages/resume
    {client_results: [{tool_call_id, output}]}
    │
    ▼
Backend: aget_state(config) → loads suspended graph from checkpoint
    │
    ▼
astream(Command(resume=client_results), config)
    │
    ▼
LangGraph resumes from client_tool_node
    │  client_tool_node reads interrupt() return value = client_results
    │  constructs ToolMessages → adds to state
    ▼
agent_node runs again → more tool calls or final response
    │
    ▼
ChatModelAdapter: reader swapped to resumeResponse.body stream
    │  seamlessly continues SSE parsing as if it were the original stream
    ▼
StreamComplete fires → /commit called
```

> **Critical:** The `config = {"configurable": {"thread_id": thread_id}}` must be the same in both the original `astream()` and the `resume` `astream()` call. This is how LangGraph knows which checkpoint to resume.

---

## 17. Key Invariants & Gotchas

### 1. Message IDs are Frontend-Generated
`userMessageId` and `assistantMessageId` are generated in `ChatModelAdapter.ts` (`crypto.randomUUID()`). They are passed in the request body to `/messages` and stored as-is. This is what enables branching: the frontend controls message identity.

### 2. `/messages` Does Not Save to DB
The `send_message` endpoint creates an in-memory `Message` object but **never calls `db.add()` or `db.commit()`**. All persistence is deferred to `/commit`. If `/commit` is never called (e.g., user closes tab mid-stream), no message is saved.

### 3. Y.js Delta is Relative to `localSnapshotRef`
`localSnapshotRef.current` is updated to the current Y.Doc state vector after each successful save (auto-save or commit). The delta sent to the backend is always `encodeStateAsUpdate(yDoc, localSnapshotRef.current)` — i.e., only the changes since the last checkpoint. Sending a delta relative to the wrong baseline will corrupt `latest_snapshot`.

### 4. `attachments_fts` Sync on Startup
`init_db()` always runs a delete+reinsert sync of `attachments_fts` on startup. This means startup is slightly slow if there are many attachments. It also means `attachments_fts` may have duplicate rows if `init_db()` fails mid-way (the `INSERT ... SELECT 'delete'` is the FTS5 way to remove existing entries before reinserting).

### 5. `think` Tool Calls Are Virtual
`think()` returns `"Thought recorded."` immediately. The agent's `evaluate_agent_step` routes `think` calls back to `agent_node` without going through `ToolNode`. Reasoning steps are accumulated in `AgentState.reasoning_steps`, not in ToolMessages. They are rendered as `"reasoning"` parts in the UI.

### 6. Document Auto-Save is Debounced (5 seconds)
`handleLocalChange` resets a 5-second debounce timer on every keystroke. The auto-save only fires if the user pauses for 5 seconds. Rapid typists may have many unsaved changes at any time. The `RequestSaveDocument` event is the safety net that flushes these before an LLM turn.

### 7. `pointer-events: none` on Composer Container
`.apcot-composer-container` has `pointer-events: none` in `_composer.scss` because it's a gradient overlay div. Only `.apcot-composer-shell` re-enables clicks via `pointer-events: auto`. Any new UI added outside `.apcot-composer-shell` but inside `.apcot-composer-container` must explicitly set `pointer-events: auto` in its inline style or via CSS.

### 8. LangGraph Checkpoint vs. App DB Thread IDs Are the Same
The same UUID `thread_id` is used as both the SQL primary key in `apcot_chat.db` and the LangGraph checkpoint `thread_id` in `langgraph_checkpoints.db`. This is intentional and the join point.

### 9. Attachment `to_dict()` Does Not Return `markdown_content`
`Attachment.to_dict()` only returns `id`, `thread_id`, `filename`, `skeleton`, `created_at`. The full `markdown_content` is intentionally omitted to prevent large payloads. It is only accessible via the LangGraph tools or direct DB queries.
