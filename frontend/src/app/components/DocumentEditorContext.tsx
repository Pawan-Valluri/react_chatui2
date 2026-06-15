import React from "react";

// Using a simple singleton to bridge CustomChat and DocumentWorkspace
// without needing to lift state up to App.tsx or use Context Providers.
// This is perfectly safe here since only one document/thread is active at a time.

export const GlobalEditorContext = {
  editorRef: React.createRef<any>(),
  markUnsaved: () => {
    console.warn("markUnsaved called before it was initialized by DocumentWorkspace");
  }
};

export function useDocumentEditor() {
  return GlobalEditorContext;
}
