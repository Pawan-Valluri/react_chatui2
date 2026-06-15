import { useState, useEffect } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckIcon, CpuIcon, ChevronDownIcon } from "./Icons";
import { Mirage } from "./loaders";

// Minimal, elegant tool UI component with smooth animation
const ToolUIBlock = ({ toolName, args, result, status }: any) => {
  const [isOpen, setIsOpen] = useState(true);

  // Auto-close when done, if it was open.
  useEffect(() => {
    if (status !== "running") {
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  }, [status]);

  return (
    <div className="apcot-tool-card" style={{ 
      marginBottom: 6, border: "1px solid var(--border-color)", borderRadius: 6, overflow: "hidden", background: "var(--bg-panel)"
    }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", fontSize: "0.8rem", color: "var(--text-secondary)", backgroundColor: "var(--bg-tertiary)", userSelect: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CpuIcon width={14} height={14} />
          <span style={{ fontWeight: 500 }}>{toolName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className={`apcot-tool-status-badge ${status}`} style={{ fontSize: "0.75rem", display: "flex", alignItems: "center" }}>
            {status === "running" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Mirage size={12} color="var(--accent-light)" speed={1.5} />
                <span>Running</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--success-color)" }}>
                <CheckIcon width={12} height={12} />
                <span>Done</span>
              </div>
            )}
          </div>
          <ChevronDownIcon width={14} height={14} style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }} />
        </div>
      </div>
      
      <div style={{ 
        display: "grid", 
        gridTemplateRows: isOpen ? "1fr" : "0fr", 
        transition: "grid-template-rows 0.3s ease-in-out" 
      }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", fontSize: "0.75rem", color: "var(--text-muted)", borderTop: "1px solid var(--border-color)", backgroundColor: "transparent" }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>Arguments:</div>
            <pre style={{ margin: 0, overflowX: "auto", fontFamily: "monospace" }}>{JSON.stringify(args, null, 2)}</pre>
            {result !== undefined && (
              <>
                <div style={{ marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Result:</div>
                <pre style={{ margin: 0, overflowX: "auto", fontFamily: "monospace" }}>{JSON.stringify(result, null, 2)}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Generic factory to create pure stateless tool UIs
const createEditorToolUI = (toolName: string) => {
  return makeAssistantToolUI<any, string>({
    toolName,
    render: function EditorToolRenderer({ args, result, status }: any) {
      return <ToolUIBlock toolName={toolName} args={args} result={result} status={status.type} />;
    }
  });
};

export const InsertParagraphTool = createEditorToolUI("insert_paragraph");
export const InsertTableTool = createEditorToolUI("insert_table");
export const InsertListTool = createEditorToolUI("insert_list");
export const ApplyStyleTool = createEditorToolUI("apply_style");

// Component to mount inside AssistantRuntimeProvider to register UIs
export const EditorTools = () => {
  return (
    <>
      <InsertParagraphTool />
      <InsertTableTool />
      <InsertListTool />
      <ApplyStyleTool />
    </>
  );
};
