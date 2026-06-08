import React, { useRef } from "react";
import { Sparkles } from "lucide-react";
import { useDocumentSync } from "./useDocumentSync";
import { DocxEditorWrapper } from "./DocxEditorWrapper";
import "./DocumentWorkspace.scss";

interface DocumentWorkspaceProps {
  threadId: string;
  messages: any[];
  userProfile?: any;
  width: number;
}

export const DocumentWorkspace: React.FC<DocumentWorkspaceProps> = ({
  threadId,
  messages,
  userProfile,
  width,
}) => {
  const editorRef = useRef<any>(null);
  
  const {
    documentBuffer,
    loading,
    savingStatus,
    error,
    handleLocalChange,
  } = useDocumentSync({
    threadId,
    messages,
    editorRef,
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
        {loading ? (
          <div className="document-loading-overlay">
            <div className="loading-spinner" />
            <span>Loading Document Workspace...</span>
          </div>
        ) : error ? (
          <div className="document-loading-overlay" style={{ color: "#ff4d4d" }}>
            <span>Error: {error}</span>
          </div>
        ) : documentBuffer ? (
          <DocxEditorWrapper
            editorRef={editorRef}
            documentBuffer={documentBuffer}
            onChange={handleLocalChange}
            userProfile={userProfile}
            width={width}
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
