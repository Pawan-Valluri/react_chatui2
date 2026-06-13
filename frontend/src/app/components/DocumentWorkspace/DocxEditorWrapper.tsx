import React from "react";
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
  documentRevision: number;
}

const DocxEditorWrapperComponent: React.FC<DocxEditorWrapperProps> = ({
  editorRef,
  documentBuffer,
  yDoc,
  onChange,
  userProfile,
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

export const DocxEditorWrapper = React.memo<DocxEditorWrapperProps>(
  DocxEditorWrapperComponent,
  (prev, next) => {
    return (
      prev.documentRevision === next.documentRevision &&
      prev.documentBuffer === next.documentBuffer &&
      prev.yDoc === next.yDoc &&
      prev.onChange === next.onChange &&
      prev.userProfile === next.userProfile &&
      prev.editorRef === next.editorRef
    );
  }
);

export default DocxEditorWrapper;

