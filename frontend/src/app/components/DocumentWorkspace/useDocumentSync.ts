import { useState, useEffect, useRef, useCallback } from "react";

export type SavingStatus = "idle" | "saving" | "saved";

interface UseDocumentSyncProps {
  threadId: string;
  editorRef: React.RefObject<any>;
  syncIntervalMs?: number; // Configurable periodic sync interval
}

export function useDocumentSync({
  threadId,
  editorRef,
  syncIntervalMs = 10000, // Default to 10 seconds, fully configurable
}: UseDocumentSyncProps) {
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingStatus, setSavingStatus] = useState<SavingStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const periodicTimerRef = useRef<NodeJS.Timeout | null>(null);
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
      const buffer = await editorRef.current.save({ selective: true });
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

  // Initial fetch on mount or thread change
  useEffect(() => {
    fetchDocument(true);

    // Clear any timers
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (periodicTimerRef.current) clearInterval(periodicTimerRef.current);
      hasUnsavedEditsRef.current = false;
    };
  }, [threadId, fetchDocument]);

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

  // Removed tool-call watcher per user requirement to prevent doc reloads.

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
