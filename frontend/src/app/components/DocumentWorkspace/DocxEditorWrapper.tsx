import React, { useEffect } from "react";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import { useDocxStyles } from "../../hooks/useDocxStyles";

interface DocxEditorWrapperProps {
  editorRef: React.RefObject<any>;
  documentBuffer: ArrayBuffer;
  onChange: () => void;
  userProfile?: any;
  width: number;
  threadId: string;
}

export const DocxEditorWrapper: React.FC<DocxEditorWrapperProps> = ({
  editorRef,
  documentBuffer,
  onChange,
  userProfile,
  threadId,
}) => {
  const userName = userProfile?.fullname || userProfile?.uid || "Beyond Developer";

  // Disable calculatedZoom to avoid breaking fixed positioning of dropdown menus
  // caused by CSS transform: scale()
  const calculatedZoom = 1.0;

  useDocxStyles(documentBuffer);

  useEffect(() => {
    if (editorRef.current && typeof editorRef.current.setZoom === "function") {
      try {
        editorRef.current.setZoom(calculatedZoom);
      } catch (e) {
        console.error("Failed to set internal page zoom:", e);
      }
    }
  }, [calculatedZoom, documentBuffer, editorRef]);

  // Removed centerScroll and ResizeObserver as it causes severe layout thrashing
  // and breaks floating dropdown menus when they trigger a resize event.

  return (
    <div style={{
      width: "100%",
      height: "100%",
      overflowX: "auto", // allow horizontal scroll if toolbar doesn't fit
      overflowY: "hidden",
      position: "relative"
    }}>
      <div 
        className="docx-editor-scaler"
        style={{ 
          height: "100%", 
          width: "100%", 
          display: "flex", 
          flexDirection: "column",
        } as React.CSSProperties}
      >
        <DocxEditor
          key={threadId}
          ref={editorRef}
          documentBuffer={documentBuffer}
          mode="editing"
          onChange={onChange}
          author={userName}
        />
      </div>
    </div>
  );
};
export default DocxEditorWrapper;
