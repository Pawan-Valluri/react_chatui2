import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";

const PlaygroundApp = () => {
  const [docBuffer, setDocBuffer] = useState<ArrayBuffer | null>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    fetch("/test_save.docx")
      .then((res) => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.arrayBuffer();
      })
      .then((buffer) => setDocBuffer(buffer))
      .catch((err) => console.error("Failed to load test document:", err));
  }, []);

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", height: "100vh" }}>
      <h2>DocxEditor Playground</h2>
      <div style={{ flex: 1, border: "1px solid #ccc", background: "#f0f0f0", overflow: "hidden" }}>
        {docBuffer ? (
          <DocxEditor
            ref={editorRef}
            documentBuffer={docBuffer}
            mode="editing"
            author="Test User"
          />
        ) : (
          <p>Loading document (make sure /test_save.docx exists)...</p>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<PlaygroundApp />);
