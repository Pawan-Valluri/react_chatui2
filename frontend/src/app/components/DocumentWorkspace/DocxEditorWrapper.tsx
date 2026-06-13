import React, { useEffect } from "react";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import { SyncEngine } from "../../../sync/SyncEngine";
import * as Y from "yjs";
import "@eigenpal/docx-editor-react/styles.css";

interface DocxEditorWrapperProps {
  editorRef: React.RefObject<any>;
  documentBuffer: ArrayBuffer;
  yDoc: Y.Doc;
  onChange: () => void;
  userProfile?: any;
  width: number;
  documentRevision: number;
}

export const DocxEditorWrapper: React.FC<DocxEditorWrapperProps> = ({
  editorRef,
  documentBuffer,
  yDoc,
  onChange,
  userProfile,
  width,
  documentRevision,
}) => {
  const userName = userProfile?.fullname || userProfile?.uid || "Beyond Developer";

  // Memoize plugins to avoid Editor re-initializations
  const plugins = React.useMemo(() => SyncEngine.getPlugins(yDoc), [yDoc]);

  return (
    <div style={{
      width: "100%",
      height: "100%",
      overflowX: "auto",
      overflowY: "hidden",
      position: "relative"
    }}>
      <DocxEditor
        key={documentRevision}
        ref={editorRef}
        documentBuffer={documentBuffer}
        mode="editing"
        onChange={onChange}
        author={userName}
        // @ts-ignore
        treatDocumentAsSchemaSeed={true}
        externalPlugins={plugins}
      />
    </div>
  );
};
export default DocxEditorWrapper;

