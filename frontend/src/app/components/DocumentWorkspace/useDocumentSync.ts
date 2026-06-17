import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs";
import { DocumentPool } from "./sync/DocumentPool";
import { prosemirrorToYXmlFragment } from "y-prosemirror";

const getEditorView = (editorRef: React.RefObject<any>) => {
  if (!editorRef.current) return null;
  try {
    if (typeof editorRef.current.getEditorRef === "function") {
      const pagedEditorRef = editorRef.current.getEditorRef();
      if (pagedEditorRef && typeof pagedEditorRef.getView === "function") {
        return pagedEditorRef.getView();
      }
    } else if (typeof editorRef.current.getView === "function") {
      return editorRef.current.getView();
    } else {
      return editorRef.current.view || editorRef.current.proseMirrorView;
    }
  } catch (err) {
    console.error("Error accessing editor view:", err);
  }
  return null;
};

const seedYDocIfEmpty = (yDoc: Y.Doc | null, editorRef: React.RefObject<any>) => {
  if (!yDoc || !editorRef.current) return;
  const xmlFragment = yDoc.getXmlFragment("prosemirror");
  if ((yDoc as any)._needsSeeding) {
    const view = getEditorView(editorRef);
    if (view) {
      yDoc.transact(() => {
        if (xmlFragment.length > 0) {
          xmlFragment.delete(0, xmlFragment.length);
        }
        prosemirrorToYXmlFragment(view.state.doc, xmlFragment);
      });
      delete (yDoc as any)._needsSeeding;
      console.log("Seeded YDoc from editor view. New length:", xmlFragment.length);
    }
  }
};


export type SavingStatus = "idle" | "saving" | "saved";
export type GuardState = "FETCHING_SNAPSHOT" | "HYDRATING_STATE" | "RESOLVING_THEME" | "READY" | "ERROR";

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
  const [guardState, setGuardState] = useState<GuardState>("FETCHING_SNAPSHOT");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [knownMessageIds, setKnownMessageIds] = useState<string[]>([]);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const localSnapshotRef = useRef<Uint8Array | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const hasUnsavedEditsRef = useRef<boolean>(false);

  // Fetch document payload from backend and resolve template cache
  const fetchDocument = useCallback(async (showLoading = true, msgId?: string) => {
    if (showLoading) {
      setLoading(true);
    }
    setGuardState("FETCHING_SNAPSHOT");
    try {
      // 1. FETCHING_SNAPSHOT
      const url = msgId ? `/api/threads/${threadId}/document?message_id=${msgId}` : `/api/threads/${threadId}/document`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load document: ${res.statusText}`);
      }
      const data = await res.json();
      
      if (data.numbering_json) {
        (window as any)._numberingConfig = data.numbering_json;
      }
      
      // 2. HYDRATING_STATE
      setGuardState("HYDRATING_STATE");
      const currentYDoc = DocumentPool.getDoc(msgId || threadId);
      yDocRef.current = currentYDoc;
      
      let isSnapshotEmpty = true;
      if (data.latest_snapshot) {
        const binarySnapStr = atob(data.latest_snapshot);
        const snapBytes = new Uint8Array(binarySnapStr.length);
        for (let i = 0; i < binarySnapStr.length; i++) {
          snapBytes[i] = binarySnapStr.charCodeAt(i);
        }
        if (snapBytes.length > 100) {
          Y.applyUpdate(currentYDoc, snapBytes);
          isSnapshotEmpty = false;
        }
      }
      
      if (isSnapshotEmpty) {
        (currentYDoc as any)._needsSeeding = true;
      }
      
      localSnapshotRef.current = Y.encodeStateVector(currentYDoc);
      
      // 3. RESOLVING_THEME
      setGuardState("RESOLVING_THEME");
      const metadataMap = currentYDoc.getMap("metadata");
      let themeHash = metadataMap.get("themeHash") as string | undefined;
      
      const defaultHash = data.default_theme_hash || data.theme_hash;
      if (!themeHash) {
        if (!defaultHash) {
          throw new Error("No default theme hash provided by backend");
        }
        // Bootstrap Fallback
        currentYDoc.transact(() => {
          metadataMap.set("themeHash", defaultHash);
        });
        themeHash = defaultHash;
      }
      
      // Check IndexedDB cache
      const { TemplateCache } = await import("./sync/TemplateCache");
      let cachedBuffer = await TemplateCache.get(themeHash!);
      
      if (!cachedBuffer) {
        const templateRes = await fetch(`/api/templates/${themeHash!}`);
        if (!templateRes.ok) {
          throw new Error(`Failed to fetch template binary for hash ${themeHash!}`);
        }
        const templateBlob = await templateRes.blob();
        cachedBuffer = await templateBlob.arrayBuffer();
        await TemplateCache.set(themeHash!, cachedBuffer);
      } else {
      }
      
      setDocumentBuffer(cachedBuffer);
      setYDoc(currentYDoc);
      console.log("fetchDocument complete. YDoc xmlFragment length:", currentYDoc.getXmlFragment("prosemirror").length);
      console.log("fetchDocument complete. YDoc xmlFragment content:", currentYDoc.getXmlFragment("prosemirror").toString().substring(0, 300));
      hasUnsavedEditsRef.current = false;
      setError(null);
      
      // 4. READY
      setGuardState("READY");
    } catch (err) {
      console.error("fetchDocument guard sequence failed:", err);
      setGuardState("ERROR");
      setError((err as any).message || "Failed to load document");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [threadId]);

  // Upload Yjs delta to backend (Debounced Auto-Save)
  const uploadDocument = useCallback(async () => {
    if (!yDocRef.current || !localSnapshotRef.current) return;
    
    seedYDocIfEmpty(yDocRef.current, editorRef);

    try {
      const delta = Y.encodeStateAsUpdate(yDocRef.current, localSnapshotRef.current);
      if (delta.length <= 2) {
        // No actual changes to save
        return;
      }
      setSavingStatus("saving");

      const url = activeMessageId ? `/api/threads/${threadId}/document?message_id=${activeMessageId}` : `/api/threads/${threadId}/document`;
      const res = await fetch(url, {
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
    } catch (err) {
      console.error("Save error:", err);
      setSavingStatus("idle");
    }
  }, [threadId, editorRef]);

  // Handle local changes from editor
  const handleLocalChange = useCallback(() => {
    seedYDocIfEmpty(yDocRef.current, editorRef);
    console.log("handleLocalChange. YDoc xmlFragment length:", yDocRef.current?.getXmlFragment("prosemirror").length);
    console.log("handleLocalChange. YDoc xmlFragment content:", yDocRef.current?.getXmlFragment("prosemirror").toString().substring(0, 300));
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
  }, [uploadDocument, editorRef]);

  // Reset local state when threadId changes
  useEffect(() => {
    setActiveMessageId(null);
    setKnownMessageIds([]);
    hasUnsavedEditsRef.current = false;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, [threadId]);

  // Handle external manual document revisions (if applicable)
  useEffect(() => {
    if (activeMessageId && activeMessageId !== "EMPTY") {
      fetchDocument(false, activeMessageId);
    }
  }, [documentRevision]);

  // Branch switching event listener
  useEffect(() => {
    const handleActiveMessage = (e: any) => {
      const { threadId: eventThreadId, leafMessageId, messageIds } = e.detail;
      if (eventThreadId === threadId) {
        if (!activeMessageId) {
          setActiveMessageId(leafMessageId);
          setKnownMessageIds(messageIds);
          fetchDocument(true, leafMessageId === "EMPTY" ? undefined : leafMessageId);
          return;
        }

        if (activeMessageId !== leafMessageId) {
          const isLinearContinuation = messageIds.includes(activeMessageId);

          if (isLinearContinuation && leafMessageId !== "EMPTY") {
            DocumentPool.aliasDoc(activeMessageId, leafMessageId);
            setActiveMessageId(leafMessageId);
            setKnownMessageIds(messageIds);
            (window as any)._documentSyncReady = true;
          } else {
            (window as any)._documentSyncReady = false;
            setActiveMessageId(leafMessageId);
            setKnownMessageIds(messageIds);
            fetchDocument(true, leafMessageId === "EMPTY" ? undefined : leafMessageId).then(() => {
              (window as any)._documentSyncReady = true;
              window.dispatchEvent(new CustomEvent("DocumentSyncReady"));
            });
          }
        }
      }
    };
    window.addEventListener("ActiveMessageChanged", handleActiveMessage);
    return () => {
      window.removeEventListener("ActiveMessageChanged", handleActiveMessage);
    };
  }, [threadId, activeMessageId, fetchDocument]);

  // MutationObserver to sync table cell background colors and hide duplicate text-run shading overlays
  useEffect(() => {
    const syncCellBackgrounds = () => {
      const hiddenTables = document.querySelectorAll(".paged-editor__hidden-pm table");
      const layoutTables = document.querySelectorAll(".layout-table");
      if (hiddenTables.length === 0 || layoutTables.length === 0) return;

      layoutTables.forEach((lTable, tIdx) => {
        const hTable = hiddenTables[tIdx];
        if (!hTable) return;
        
        const lRows = lTable.querySelectorAll(".layout-table-row");
        const hRows = hTable.querySelectorAll("tr");
        
        lRows.forEach((lRow, rIdx) => {
          const hRow = hRows[rIdx];
          if (!hRow) return;
          
          const lCells = lRow.querySelectorAll(".layout-table-cell");
          const hCells = hRow.querySelectorAll("td, th");
          
          lCells.forEach((lCell, cIdx) => {
            const hCell = hCells[cIdx] as HTMLElement;
            if (!hCell) return;
            
            let bg = hCell.getAttribute("data-bgcolor") || hCell.getAttribute("bgcolor") || hCell.style.backgroundColor || "";
            if (bg && !bg.startsWith("#") && !bg.startsWith("rgb") && bg !== "transparent") {
              bg = "#" + bg;
            }
            const lCellEl = lCell as HTMLElement;
            if (lCellEl.style.backgroundColor !== bg) {
              lCellEl.style.backgroundColor = bg;
            }
            
            // Clean up text run/paragraph level background shading highlights inside cells
            if (bg) {
              const contentChildren = lCellEl.querySelectorAll('.layout-run, .layout-paragraph, .layout-line');
              contentChildren.forEach((child) => {
                const childEl = child as HTMLElement;
                if (childEl.style.backgroundColor && childEl.style.backgroundColor !== 'transparent') {
                  childEl.style.backgroundColor = 'transparent';
                }
              });
            }
          });
        });
      });
    };

    const hideDuplicateOverlays = () => {
      const overlayDivs = document.querySelectorAll(".paged-editor__decoration-overlay div");
      overlayDivs.forEach((div) => {
        const el = div as HTMLElement;
        const bg = el.style.backgroundColor;
        if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
          el.style.display = "none";
        }
      });
    };

    const observer = new MutationObserver(() => {
      syncCellBackgrounds();
      hideDuplicateOverlays();
    });

    const container = document.querySelector(".document-editor-viewport");
    if (container) {
      observer.observe(container, { childList: true, subtree: true });
      syncCellBackgrounds();
      hideDuplicateOverlays();
    }

    return () => observer.disconnect();
  }, [threadId, documentRevision]);

  // Listen for Stateless Remote Tool Execution & Stream Completion
  useEffect(() => {


    const handleStreamComplete = async (e: any) => {
      const { userMessageId, parentId, userContent, assistantMessageId, assistantParts } = e.detail;
      if (!yDocRef.current || !localSnapshotRef.current) return;
      
      seedYDocIfEmpty(yDocRef.current, editorRef);
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
          } else {
          }
      } catch(err) {
      }
    };

    const handleRollback = () => {
      console.warn("Rolling back frontend edits due to network failure");
      fetchDocument(false);
    };

    const handleRequestSave = async () => {
      seedYDocIfEmpty(yDocRef.current, editorRef);
      if (hasUnsavedEditsRef.current) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        await uploadDocument();
      }
      window.dispatchEvent(new CustomEvent("DocumentSaved"));
    };

    window.addEventListener("StreamComplete", handleStreamComplete);
    window.addEventListener("RollbackFrontendEdits", handleRollback);
    window.addEventListener("RequestSaveDocument", handleRequestSave);
    return () => {
      window.removeEventListener("StreamComplete", handleStreamComplete);
      window.removeEventListener("RollbackFrontendEdits", handleRollback);
      window.removeEventListener("RequestSaveDocument", handleRequestSave);
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
    guardState,
  };
}
