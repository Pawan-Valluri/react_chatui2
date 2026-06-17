
export const createChatModelAdapter = (threadId: string, onThreadUpdated?: () => void) => {
  return async function* run({ messages, abortSignal, unstable_assistantMessageId }: any) {
    if (!messages || messages.length === 0) return;
    
    const userMessage = messages[messages.length - 1];
    
    // We no longer rely on `isResume` from the top level because we handle interrupts and resume natively inside the generator!
    const userMessageId = userMessage?.id;
    const parentMessage = messages[messages.length - 2];
    const parentMessageId = parentMessage?.id || null;
    const assistantMessageId = unstable_assistantMessageId || crypto.randomUUID();

    window.dispatchEvent(new CustomEvent("RequestSaveDocument"));
    await new Promise(resolve => setTimeout(resolve, 800));

    yield { id: assistantMessageId, content: [] };

    let textContent = "";
    if (typeof userMessage.content === "string") {
      textContent = userMessage.content;
    } else if (Array.isArray(userMessage.content) && userMessage.content.length > 0) {
      textContent = userMessage.content[0].text || "";
    }

    // Wait for document reconstruction to finish if jumping branches
    if ((window as any)._documentSyncReady === false) {
      await new Promise(resolve => {
        const handler = () => {
          window.removeEventListener("DocumentSyncReady", handler);
          resolve(true);
        };
        window.addEventListener("DocumentSyncReady", handler);
      });
    }

    let response = await fetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: userMessageId,
        parentId: parentMessageId,
        assistantMessageId: assistantMessageId,
        content: textContent,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error("Failed to send message to APCOT Chat API");
    }


    let reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
    let latestAssistantParts: any[] = [];
    
    const assistantMsgIdToYield = assistantMessageId;

    try {
      while (true) {
        if (!reader) break;
        const { done, value } = await reader.read();
        if (done) {
          window.dispatchEvent(new CustomEvent("StreamComplete", {
            detail: {
              userMessageId,
              parentId: parentMessageId,
              userContent: textContent,
              assistantMessageId: assistantMsgIdToYield,
              assistantParts: latestAssistantParts
            }
          }));
          // Refresh threads list after commit so the new title is reflected immediately
          if (onThreadUpdated) setTimeout(() => onThreadUpdated!(), 600);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.substring(7);
          } else if (trimmed.startsWith("data: ")) {
            const data = trimmed.substring(6);

            if (currentEvent === "requires_action") {
              const parsedInterrupt = JSON.parse(data);
              const toolCalls = parsedInterrupt.tool_calls;
              
              // 1. Execute tools synchronously against the Editor
              const client_results = [];
              try {
                const { EditorBridge } = await import("./DocumentWorkspace/sync/EditorBridge");
                const { GlobalEditorContext } = await import("./DocumentEditorContext");
                
                const editorRef = GlobalEditorContext.editorRef;
                if (editorRef.current) {
                  let view = null;
                  if (typeof editorRef.current.getEditorRef === 'function') {
                    const pagedRef = editorRef.current.getEditorRef();
                    if (pagedRef && typeof pagedRef.getView === 'function') view = pagedRef.getView();
                  } else if (typeof editorRef.current.getView === 'function') {
                    view = editorRef.current.getView();
                  } else {
                    view = editorRef.current.view || editorRef.current.proseMirrorView;
                  }
                  
                  if (view) {
                    const bridge = new EditorBridge(view, editorRef.current);
                    for (const tc of toolCalls) {
                      try {
                        bridge.executeToolCall(tc?.name, tc?.args);
                        client_results.push({ tool_call_id: tc?.id, output: "Success" });
                      } catch (err: any) {
                        client_results.push({ tool_call_id: tc?.id, output: "Error: " + err.message });
                      }
                    }
                    GlobalEditorContext.markUnsaved();
                  } else {
                    toolCalls.forEach((tc: any) => client_results.push({ tool_call_id: tc?.id, output: "Error: No Editor View" }));
                  }
                } else {
                  toolCalls.forEach((tc: any) => client_results.push({ tool_call_id: tc?.id, output: "Error: No Editor Ref" }));
                }
              } catch (e: any) {
                 toolCalls.forEach((tc: any) => client_results.push({ tool_call_id: tc?.id, output: "Error: " + e.message }));
              }
              
              // 2. POST results to /resume
              const resumeResponse = await fetch(`/api/threads/${threadId}/messages/resume`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  client_results,
                  assistantMessageId: assistantMsgIdToYield,
                  parentId: parentMessageId
                }),
                signal: abortSignal,
              });
              
              if (!resumeResponse.ok) {
                throw new Error("Failed to resume execution");
              }
              
              // 3. Swap the reader to continue streaming the resumed response seamlessly!
              if (reader) reader.releaseLock();
              reader = resumeResponse.body?.getReader();
              if (!reader) break;
              
              // Skip the rest of the lines processing since we swapped the stream
              break;
            }

            if (currentEvent === "parts") {
              const parsedParts = JSON.parse(data);
              latestAssistantParts = parsedParts;
              yield { id: assistantMsgIdToYield, content: parsedParts };
            }
          }
        }
      }
    } finally {
      if (reader) reader.releaseLock();
    }
  };
};
