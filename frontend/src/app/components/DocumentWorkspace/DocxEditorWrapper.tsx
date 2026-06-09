import React, { useEffect } from "react";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";

interface DocxEditorWrapperProps {
  editorRef: React.RefObject<any>;
  documentBuffer: ArrayBuffer;
  onChange: () => void;
  userProfile?: any;
  width: number;
  documentRevision: number;
}

export const DocxEditorWrapper: React.FC<DocxEditorWrapperProps> = ({
  editorRef,
  documentBuffer,
  onChange,
  userProfile,
  width,
  documentRevision,
}) => {
  const userName = userProfile?.fullname || userProfile?.uid || "Beyond Developer";

  // Base width at which the desktop editor toolbar and page fit comfortably.
  const baseWidth = 860;
  const calculatedZoom = Math.max(0.4, Math.min(1.0, (width - 20) / baseWidth));

  useEffect(() => {
    if (editorRef.current && typeof editorRef.current.setZoom === "function") {
      try {
        editorRef.current.setZoom(calculatedZoom);
      } catch (e) {
        console.error("Failed to set internal page zoom:", e);
      }
    }
  }, [calculatedZoom, documentBuffer, editorRef]);

  // Use a ResizeObserver to robustly center the internal scroll container whenever its size changes.
  // This handles sidebar CSS transitions perfectly.
  useEffect(() => {
    const wrapperNode = document.querySelector('.docx-editor-scaler');
    if (!wrapperNode) return;

    const centerScroll = () => {
      // Find the specific container that Eigenpal uses for scrolling the page area.
      // We know it has overflow: auto and overflow-anchor: none from inline styles.
      const editorRoot = document.querySelector('.ep-root');
      if (!editorRoot) return;
      
      const scrollContainers = editorRoot.querySelectorAll('div');
      
      for (let i = 0; i < scrollContainers.length; i++) {
        const el = scrollContainers[i];
        // Target the element that actually has horizontal overflow
        if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) {
          // Check if this is the main editor canvas container (it usually has overflow: auto)
          const style = window.getComputedStyle(el);
          if (style.overflow === 'auto' || style.overflowX === 'auto' || el.style.overflowAnchor === 'none') {
            el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
          }
        }
      }
    };

    // Run once initially
    setTimeout(centerScroll, 100);
    setTimeout(centerScroll, 500); // safety net after load

    const observer = new ResizeObserver(() => {
      centerScroll();
    });

    observer.observe(wrapperNode);

    return () => observer.disconnect();
  }, [width]);

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
          key={documentRevision}
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

