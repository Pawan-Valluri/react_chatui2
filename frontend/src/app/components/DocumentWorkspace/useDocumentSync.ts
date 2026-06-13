import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs";
import { DocumentPool } from "../../../sync/DocumentPool";

export type SavingStatus = "idle" | "saving" | "saved";

interface UseDocumentSyncProps {
  threadId: string;
  editorRef: React.RefObject<any>;
  documentRevision: number;
}

export function useDocumentSync({
  threadId,
  editorRef,
  documentRevision,
}: UseDocumentSyncProps) {
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [yDoc, setYDoc] = useState<Y.Doc | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingStatus, setSavingStatus] = useState<SavingStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const localSnapshotRef = useRef<Uint8Array | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const hasUnsavedEditsRef = useRef<boolean>(false);

  // Fetch document payload from backend
  const fetchDocument = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/threads/${threadId}/document`);
      if (!res.ok) {
        throw new Error(`Failed to load document: ${res.statusText}`);
      }
      const data = await res.json();
      
      // Convert base64 docx blob to ArrayBuffer
      const binaryDocxStr = atob(data.docx_blob);
      const len = binaryDocxStr.length;
      const docxBytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        docxBytes[i] = binaryDocxStr.charCodeAt(i);
      }
      
      const currentYDoc = DocumentPool.getDoc(threadId);
      yDocRef.current = currentYDoc;
      
      if (data.latest_snapshot) {
        const binarySnapStr = atob(data.latest_snapshot);
        const snapBytes = new Uint8Array(binarySnapStr.length);
        for (let i = 0; i < binarySnapStr.length; i++) {
          snapBytes[i] = binarySnapStr.charCodeAt(i);
        }
        Y.applyUpdate(currentYDoc, snapBytes);
      }
      
      localSnapshotRef.current = Y.encodeStateVector(currentYDoc);
      
      setDocumentBuffer(docxBytes.buffer);
      setYDoc(currentYDoc);
      hasUnsavedEditsRef.current = false;
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load document");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [threadId]);

  // Upload Yjs delta to backend (Debounced Auto-Save)
  const uploadDocument = useCallback(async () => {
    if (!yDocRef.current || !localSnapshotRef.current) return;
    
    try {
      const delta = Y.encodeStateAsUpdate(yDocRef.current, localSnapshotRef.current);
      if (delta.length === 0) {
        // No actual changes to save
        return;
      }
      setSavingStatus("saving");

      const res = await fetch(`/api/threads/${threadId}/document`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: delta as any,
      });

      if (!res.ok) {
        throw new Error(`Failed to auto-save changes: ${res.statusText}`);
      }

      setSavingStatus("saved");
      hasUnsavedEditsRef.current = false;
      localSnapshotRef.current = Y.encodeStateVector(yDocRef.current);
      
      // Reset status to idle after a visual timeout
      setTimeout(() => {
        setSavingStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 3000);
    } catch (err: any) {
      console.error("Save error:", err);
      setSavingStatus("idle");
    }
  }, [threadId]);

  // Handle local changes from editor
  const handleLocalChange = useCallback(() => {
    hasUnsavedEditsRef.current = true;
    setSavingStatus("idle");

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer (5 seconds after user stops typing)
    debounceTimerRef.current = setTimeout(() => {
      uploadDocument();
    }, 5000);
  }, [uploadDocument]);

  // Initial fetch on mount, thread change, or documentRevision change
  useEffect(() => {
    fetchDocument(true);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      hasUnsavedEditsRef.current = false;
    };
  }, [threadId, fetchDocument, documentRevision]);

  // Listen for Stateless Remote Tool Execution & Stream Completion
  useEffect(() => {
    const handleExecuteFrontendTool = (e: any) => {
      const toolCalls = e.detail.tool_calls;
      console.log("Interrupt Payload Received: Executing frontend tools", toolCalls);
      
      const results: any[] = [];
      
      if (editorRef.current) {
        import("../../../sync/EditorBridge").then(({ EditorBridge }) => {
          let view = null;
          try {
            if (typeof editorRef.current?.getEditorRef === 'function') {
              const pagedEditorRef = editorRef.current.getEditorRef();
              if (pagedEditorRef && typeof pagedEditorRef.getView === 'function') {
                view = pagedEditorRef.getView();
              }
            } else if (typeof editorRef.current?.getView === 'function') {
              view = editorRef.current.getView();
            } else {
              view = editorRef.current?.view || editorRef.current?.proseMirrorView;
            }
          } catch (err) {
            console.error("Error accessing editor view:", err);
          }
          
          if (view) {
            const bridge = new EditorBridge(view, editorRef.current);
            for (const tc of toolCalls) {
              try {
                bridge.executeToolCall(tc.name, tc.args);
                results.push({ tool_call_id: tc.id, output: "Success" });
              } catch (err: any) {
                console.error(`Tool execution failed for ${tc.name}:`, err);
                results.push({ tool_call_id: tc.id, output: `Error: ${err.message}` });
              }
            }
            
            hasUnsavedEditsRef.current = true;
            window.dispatchEvent(new CustomEvent("FrontendToolResult", { detail: { results } }));
          } else {
            console.error("Could not find ProseMirror view on editorRef");
            for (const tc of toolCalls) {
               results.push({ tool_call_id: tc.id, output: "Error: Frontend Editor view not found" });
            }
            window.dispatchEvent(new CustomEvent("FrontendToolResult", { detail: { results } }));
          }
        });
      } else {
         for (const tc of toolCalls) {
            results.push({ tool_call_id: tc.id, output: "Error: editorRef is null" });
         }
         window.dispatchEvent(new CustomEvent("FrontendToolResult", { detail: { results } }));
      }
    };

    const handleStreamComplete = async (e: any) => {
      const { userMessageId, parentId, userContent, assistantMessageId, assistantParts } = e.detail;
      if (!yDocRef.current || !localSnapshotRef.current) return;
      
      const delta = Y.encodeStateAsUpdate(yDocRef.current, localSnapshotRef.current);
      
      const metadata = {
          user_message_id: userMessageId,
          parent_id: parentId,
          user_content: userContent,
          assistant_message_id: assistantMessageId,
          assistant_parts: assistantParts
      };
      
      try {
          const res = await fetch(`/api/threads/${threadId}/commit`, {
              method: "POST",
              headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Commit-Metadata": JSON.stringify(metadata)
              },
              body: delta as any
          });
          
          if (res.ok) {
              localSnapshotRef.current = Y.encodeStateVector(yDocRef.current);
              console.log("Atomic commit successful");
          } else {
              console.error("Failed to explicit commit:", res.statusText);
          }
      } catch(err) {
          console.error("Failed to explicit commit:", err);
      }
    };

    const handleRollback = () => {
      console.warn("Rolling back frontend edits due to network failure");
      fetchDocument(false);
    };

    window.addEventListener("ExecuteFrontendTool", handleExecuteFrontendTool);
    window.addEventListener("StreamComplete", handleStreamComplete);
    window.addEventListener("RollbackFrontendEdits", handleRollback);
    return () => {
      window.removeEventListener("ExecuteFrontendTool", handleExecuteFrontendTool);
      window.removeEventListener("StreamComplete", handleStreamComplete);
      window.removeEventListener("RollbackFrontendEdits", handleRollback);
    };
  }, [editorRef, threadId, fetchDocument]);

  const downloadDocument = useCallback(() => {
    if (!documentBuffer) return;
    const blob = new Blob([documentBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `document_${threadId}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [documentBuffer, threadId]);

  return {
    documentBuffer,
    yDoc,
    loading,
    savingStatus,
    error,
    handleLocalChange,
    downloadDocument,
    saveDocument: uploadDocument,
  };
}
