# Workspace UI & Document Canvas Integration & Porting Guide

This document records the exact changes made to implement the collapsible, resizable, and auto-expanding **Workspace** right panel, integrating a native Word `.docx` editor via `@eigenpal/docx-editor-react` and backend edits via `python-docx`.

---

## 1. Directory Structure Changes

### Backend Service & Storage
- Service: [document_service.py](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/backend/app/services/document_service.py) — abstracts python-docx, OOXML Tracked Changes, I/O writes, and AI revision attributions.
- Local Storage: `/home/beyond/Space/Workspace1/assistatant_react_ui2/backend/storage/documents/thread_{thread_id}.docx` — scopes document per thread ID.

### Frontend Encapsulated Module
- Folder: [DocumentWorkspace](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/frontend/src/app/components/DocumentWorkspace/)
  - [index.ts](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/frontend/src/app/components/DocumentWorkspace/index.ts) — exports components.
  - [DocumentWorkspace.tsx](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/frontend/src/app/components/DocumentWorkspace/DocumentWorkspace.tsx) — renders headers, status spinner, and layout.
  - [DocxEditorWrapper.tsx](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/frontend/src/app/components/DocumentWorkspace/DocxEditorWrapper.tsx) — mounts `DocxEditor` with user details for revision attributions.
  - [useDocumentSync.ts](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/frontend/src/app/components/DocumentWorkspace/useDocumentSync.ts) — handles fetching, 2.5s debounced autosave, configurable periodic save heartbeat (10s), and reactive refetches on completed agent tool calls.
  - [DocumentWorkspace.scss](file:///home/beyond/Space/Workspace1/assistatant_react_ui2/frontend/src/app/components/DocumentWorkspace/DocumentWorkspace.scss) — encapsulation styles.

---

## 2. Layout Integration (`App.tsx`)

The Workspace panel sits inside the main `.apcot-app-shell` container as a sibling to `ChatArea`:

```tsx
// Imports
import { Workspace } from "./components/Workspace";
import { DocumentWorkspace } from "./components/DocumentWorkspace";

// States
const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(true);
const [workspaceWidth, setWorkspaceWidth] = useState(450);

// Auto-expansion trigger
useEffect(() => {
  if (currentThreadId) {
    setIsWorkspaceCollapsed(false);
  }
}, [currentThreadId]);

// Render layout
return (
  <div className="apcot-app-shell">
    <Sidebar ... />
    <ChatArea
      ...
      isWorkspaceCollapsed={isWorkspaceCollapsed}
      onToggleWorkspace={() => setIsWorkspaceCollapsed((prev) => !prev)}
    />
    <Workspace
      isCollapsed={isWorkspaceCollapsed}
      onToggleCollapse={() => setIsWorkspaceCollapsed(true)}
      width={workspaceWidth}
      onWidthChange={setWorkspaceWidth}
    >
      {currentThreadId && (
        <DocumentWorkspace 
          threadId={currentThreadId} 
          messages={currentThreadMessages}
          userProfile={userProfile}
        />
      )}
    </Workspace>
  </div>
);
```

---

## 3. API Endpoints (`threads.py`)

Two API endpoints were added in FastAPI:
- `GET /api/threads/{thread_id}/document`: Serves the `.docx` file as binary. Creates a default template if not found.
- `PUT /api/threads/{thread_id}/document`: Receives edited document bytes in body and writes them to storage.

---

## 4. Agent Tool (`agent.py`)

A new tool `edit_document` is registered:
- **Display name for AI edits:** `APCOT Assistant` in OOXML revisions.
- **Propagation:** Uses a `contextvars.ContextVar` to propagate the current active `thread_id` inside graph execution.

---

## 5. Mock Showcase (`mock_llm.py` and `mock_routes.py`)

- In showcase mode, when a user prompt matches document keywords, the mock LLM triggers the `edit_document` tool, which saves to the real storage, and sends an acknowledgment message: *"I have updated your document... You should see it update in the Workspace panel on your right."*
