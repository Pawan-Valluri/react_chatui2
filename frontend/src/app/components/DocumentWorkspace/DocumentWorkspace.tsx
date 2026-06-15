import React, { useRef } from "react";
import { Sparkles } from "lucide-react";
import { useDocumentSync } from "./useDocumentSync";
import { DocxEditorWrapper } from "./DocxEditorWrapper";
import "./DocumentWorkspace.scss";

interface DocumentWorkspaceProps {
  threadId: string;
  userProfile?: any;
  documentRevision: number;
}

export const DocumentWorkspace: React.FC<DocumentWorkspaceProps> = ({
  threadId,
  userProfile,
  documentRevision,
}) => {
  const editorRef = useRef<any>(null);
  
  const {
    documentBuffer,
    yDoc,
    savingStatus,
    error,
    handleLocalChange,
    guardState,
  } = useDocumentSync({
    threadId,
    editorRef,
    documentRevision,
  });

  return (
    <div className="document-workspace-container">
      {/* Floating Saving Indicator */}
      {savingStatus === "saving" && (
        <div className="floating-status-badge saving">
          <span className="saving-spinner" />
          Saving...
        </div>
      )}
      {savingStatus === "saved" && (
        <div className="floating-status-badge saved">
          ✓ Saved
        </div>
      )}

      {/* Editor viewport */}
      <div className="document-editor-viewport">
        {guardState !== "READY" && guardState !== "ERROR" ? (
          <div className="document-loading-overlay">
            <div className="loading-spinner" />
            <span style={{ marginTop: "12px", fontSize: "0.9rem", color: "var(--fg-muted)" }}>
              {guardState === "FETCHING_SNAPSHOT" && "Fetching document snapshot..."}
              {guardState === "HYDRATING_STATE" && "Hydrating collaborative state..."}
              {guardState === "RESOLVING_THEME" && "Resolving design template cache..."}
            </span>
          </div>
        ) : error || guardState === "ERROR" ? (
          <div className="document-loading-overlay" style={{ color: "#ff4d4d" }}>
            <span>Error: {error || "Failed to initialize document state"}</span>
          </div>
        ) : documentBuffer && yDoc ? (
          <DocxEditorWrapper
            editorRef={editorRef}
            documentBuffer={documentBuffer}
            yDoc={yDoc}
            onChange={handleLocalChange}
            userProfile={userProfile}
            documentRevision={documentRevision}
          />
        ) : (
          <div className="document-loading-overlay">
            <Sparkles size={24} style={{ color: "var(--accent-light)", opacity: 0.6 }} />
            <span>No document active. Select a conversation to load.</span>
          </div>
        )}
      </div>
    </div>
  );
};
export default DocumentWorkspace;
