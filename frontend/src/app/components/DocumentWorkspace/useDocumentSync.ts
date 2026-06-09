import { useState, useEffect, useRef, useCallback } from "react";

export type SavingStatus = "idle" | "saving" | "saved";

interface UseDocumentSyncProps {
  threadId: string;
  messages: any[];
  editorRef: React.RefObject<any>;
  syncIntervalMs?: number; // Configurable periodic sync interval
  documentRevision: number;
}

export function useDocumentSync({
  threadId,
  messages,
  editorRef,
  syncIntervalMs = 10000, // Default to 10 seconds, fully configurable
  documentRevision,
}: UseDocumentSyncProps) {
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingStatus, setSavingStatus] = useState<SavingStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const periodicTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processedToolCallsRef = useRef<Set<string>>(new Set());
  const hasUnsavedEditsRef = useRef<boolean>(false);

  // Fetch document buffer from backend
  const fetchDocument = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/threads/${threadId}/document`);
      if (!res.ok) {
        throw new Error(`Failed to load document: ${res.statusText}`);
      }
      const buffer = await res.arrayBuffer();
      setDocumentBuffer(buffer);
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

  // Upload updated buffer to backend
  const uploadDocument = useCallback(async () => {
    if (!editorRef.current) return;
    
    setSavingStatus("saving");
    try {
      // Imperatively save and get updated ArrayBuffer from docx-editor
      const buffer = await editorRef.current.save();
      if (!buffer) {
        throw new Error("Editor returned empty buffer");
      }

      const res = await fetch(`/api/threads/${threadId}/document`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: buffer,
      });

      if (!res.ok) {
        throw new Error(`Failed to upload changes: ${res.statusText}`);
      }

      setSavingStatus("saved");
      hasUnsavedEditsRef.current = false;
      
      // Reset status to idle after a visual timeout
      setTimeout(() => {
        setSavingStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 3000);
    } catch (err: any) {
      console.error("Save error:", err);
      setSavingStatus("idle");
    }
  }, [threadId, editorRef]);

  // Handle local changes from editor
  const handleLocalChange = useCallback(() => {
    hasUnsavedEditsRef.current = true;
    setSavingStatus("idle");

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer (2.5 seconds after user stops typing)
    debounceTimerRef.current = setTimeout(() => {
      uploadDocument();
    }, 2500);
  }, [uploadDocument]);

  // Initial fetch on mount, thread change, or documentRevision change
  useEffect(() => {
    fetchDocument(true);

    // Clear any timers
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (periodicTimerRef.current) clearInterval(periodicTimerRef.current);
      hasUnsavedEditsRef.current = false;
    };
  }, [threadId, fetchDocument, documentRevision]);

  // Configurable Periodic sync heartbeat (saves changes every N seconds if there are unsaved edits)
  useEffect(() => {
    if (periodicTimerRef.current) {
      clearInterval(periodicTimerRef.current);
    }

    periodicTimerRef.current = setInterval(() => {
      if (hasUnsavedEditsRef.current) {
        console.log(`Periodic sync heartbeat triggered (${syncIntervalMs / 1000}s)`);
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        uploadDocument();
      }
    }, syncIntervalMs);

    return () => {
      if (periodicTimerRef.current) {
        clearInterval(periodicTimerRef.current);
      }
    };
  }, [syncIntervalMs, uploadDocument]);

  // Listen to messages for completed agent tool calls
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Scan messages for completed edit_document tool calls
    let newCompletedEditFound = false;

    messages.forEach((msg) => {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        msg.content.forEach((part: any) => {
          if (part.type === "tool-call" && part.toolName === "edit_document") {
            const isComplete = part.status === "complete" || part.result;
            const toolCallId = part.toolCallId;
            
            if (isComplete && toolCallId && !processedToolCallsRef.current.has(toolCallId)) {
              processedToolCallsRef.current.add(toolCallId);
              newCompletedEditFound = true;
              console.log("Reactive reload: Agent finished edit_document tool call:", toolCallId);
            }
          }
        });
      }
    });

    if (newCompletedEditFound) {
      // Reload document silently in background so that editor receives agent's updates
      fetchDocument(false);
    }
  }, [messages, fetchDocument]);

  // Trigger manual download of document
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
    loading,
    savingStatus,
    error,
    handleLocalChange,
    downloadDocument,
    saveDocument: uploadDocument,
  };
}
