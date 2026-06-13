import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";

const PlaygroundApp = () => {
  const [docBuffer, setDocBuffer] = useState<ArrayBuffer | null>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    // Expose for debugging
    (window as any).editorRef = editorRef;
    
    fetch("/test_save.docx")
      .then((res) => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.arrayBuffer();
      })
      .then((buffer) => setDocBuffer(buffer))
      .catch((err) => console.error("Failed to load test document:", err));
  }, []);

  const handleTestExecuteCommand = async () => {
    if (!editorRef.current?.getAgent) return;
    const agent = editorRef.current.getAgent();
    if (!agent) return;
    
    try {
      console.log("Using agent.insertTable...");
      const paragraphCount = agent.getParagraphCount();
      const newAgent = agent.insertTable({ paragraphIndex: paragraphCount > 0 ? paragraphCount - 1 : 0, offset: 0 }, 3, 3);
      if (typeof newAgent.executeCommands === 'function') {
         newAgent.executeCommands();
      }
      
      // Attempt to apply style
      const tableCount = newAgent.getTableCount();
      if (tableCount > 0) {
        // DocxEditor might not have a direct applyTableStyle but we can try
      }
      
      console.log("Table inserted via agent!");
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestManualCreate = async () => {
    if (!editorRef.current?.getEditorRef) {
      console.error("editorRef not ready", editorRef.current);
      return;
    }
    const view = editorRef.current.getEditorRef()?.getView();
    if (!view) {
      console.error("view not ready");
      return;
    }
    if (!view) return;
    const { state, dispatch } = view;
    const { schema } = state;
    
    let insertPos = state.doc.content.size;
    const genParaId = () => Math.random().toString(16).slice(2, 10).toUpperCase();

    let tr = state.tr;
    ['Title', '22', 'Heading1', '1'].forEach((styleId) => {
      const pNode = schema.nodes.paragraph.create({ paraId: genParaId(), styleId }, schema.text(`Test paragraph with styleId=${styleId}`));
      tr = tr.insert(insertPos, pNode);
      insertPos += pNode.nodeSize;
    });
    dispatch(tr);

    const nodeKeys = Object.keys(schema.nodes);
    const tName = nodeKeys.find(n => n === 'table' || n === 'tbl' || n === 'tableNode') || 'table';
    const rName = nodeKeys.find(n => n === 'table_row' || n === 'tableRow' || n === 'tr') || 'table_row';
    const cName = nodeKeys.find(n => n === 'table_cell' || n === 'tableCell' || n === 'tc') || 'table_cell';
    const tableType = schema.nodes[tName];
    const rowType = schema.nodes[rName];
    const cellType = schema.nodes[cName];

    // Use agent.executeCommands if available
    const editorRef = (window as any)._editorRef;
    if (editorRef && editorRef.current) {
      const agent = editorRef.current.getAgent();
      if (agent && agent.executeCommands) {
        console.log('Calling agent.executeCommands');
        try {
          const newAgent = agent.executeCommands([
            {
              type: 'insertTable',
              paraId: 'editor_root',
              rows: 3,
              cols: 3,
              styleId: 'HeadingTable'
            }
          ]);
          console.log('Execute commands returned:', newAgent);
        } catch (err) {
          console.error('executeCommands error:', err);
        }
      }
    }
  };

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", height: "100vh" }}>
      <h2>DocxEditor Playground</h2>
      <div style={{ marginBottom: "20px" }}>
        <button onClick={handleTestExecuteCommand} style={{ marginRight: 10 }}>
          Test executeCommand (Insert Table)
        </button>
        <button onClick={handleTestManualCreate}>
          Test Manual Insert Table
        </button>
      </div>
      <div style={{ flex: 1, border: "1px solid #ccc", background: "#f0f0f0", overflow: "hidden" }}>
        {docBuffer ? (
          <DocxEditor
            ref={editorRef}
            documentBuffer={docBuffer}
            mode="editing"
            author="Test User"
          />
        ) : (
          <p>Loading document...</p>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<PlaygroundApp />);
