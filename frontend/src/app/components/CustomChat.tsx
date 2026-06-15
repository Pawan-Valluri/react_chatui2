import React, { useState } from "react";
import { 
  useLocalRuntime, 
  AssistantRuntimeProvider,
  useAuiState,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ExportedMessageRepository
} from "@assistant-ui/react";
import { 
  SendIcon, 
  StopIcon, 
  PaperclipIcon, 
  BrainIcon, 
  ChevronDownIcon, 
  CpuIcon, 
  CheckIcon,
  SparklesIcon
} from "./Icons";
import { Mirage } from "./loaders";

// Custom inline SVGs for editing and branching
const PencilIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const ChevronLeftIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const ChevronRightIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

// Core Interfaces
interface MessagePart {
  type: "text" | "reasoning" | "tool-call";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: any;
  result?: any;
  status?: "running" | "complete";
}

interface CustomChatProps {
  threadId: string;
  initialMessages: any[];
  pendingPrompt: string | null;
  onClearPendingPrompt: () => void;
  onThreadUpdated?: () => void;
  onDocumentUpdated?: () => void;
  starterPrompts?: any[];
}

// --------------------------------------------------------------------------
// Collapsible Reasoning/Thinking Component
// --------------------------------------------------------------------------
interface ReasoningBlockProps {
  text: string;
  autoCollapse?: boolean;
}

const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ text, autoCollapse }) => {
  const [isOpen, setIsOpen] = useState(!autoCollapse);

  React.useEffect(() => {
    if (autoCollapse) {
      setIsOpen(false);
    }
  }, [autoCollapse]);

  return (
    <div className={`apcot-reasoning-card ${isOpen ? "open" : ""}`}>
      <div className="apcot-reasoning-header" onClick={() => setIsOpen(!isOpen)} style={{ cursor: "pointer" }}>
        <div className="apcot-reasoning-title-section">
          <BrainIcon />
          <span>Thought Process</span>
        </div>
        <div className="apcot-reasoning-toggle-icon">
          <ChevronDownIcon />
        </div>
      </div>
      <div className="apcot-reasoning-body-wrapper">
        <div className="apcot-reasoning-body">
          {text}
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------
// Tool Execution Visualizer Card
// --------------------------------------------------------------------------
interface ToolCallBlockProps {
  toolName: string;
  args: any;
  result?: any;
  status: "running" | "complete";
  autoCollapse?: boolean;
}

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ 
  toolName, 
  args, 
  result, 
  status, 
  autoCollapse 
}) => {
  const [isOpen, setIsOpen] = useState(!autoCollapse);

  React.useEffect(() => {
    if (autoCollapse) {
      setIsOpen(false);
    }
  }, [autoCollapse]);

  return (
    <div className={`apcot-tool-card ${isOpen ? "open" : ""}`}>
      <div className="apcot-tool-header" onClick={() => setIsOpen(!isOpen)} style={{ cursor: "pointer" }}>
        <div className="apcot-tool-title-section">
          <CpuIcon />
          <span>{toolName}(...)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className={`apcot-tool-status-badge ${status}`}>
            {status === "running" ? (
              <>
                <Mirage size={24} color="var(--accent-light)" speed={1.5} />
                Running
              </>
            ) : (
              <>
                <CheckIcon />
                Complete
              </>
            )}
          </div>
          <div className="apcot-reasoning-toggle-icon" style={{ display: "flex", alignItems: "center" }}>
            <ChevronDownIcon style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform var(--transition-normal)" }} />
          </div>
        </div>
      </div>
      <div className="apcot-tool-body-wrapper">
        <div className="apcot-tool-details">
          <div className="apcot-tool-args">
            <strong>Arguments:</strong> {JSON.stringify(args)}
          </div>
          {result && (
            <div style={{ marginTop: "8px" }}>
              <div className="apcot-tool-result-header">Result Output</div>
              <div className="apcot-tool-result">{result}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------
// Branch Selector & User Edit Composer components
// --------------------------------------------------------------------------
const BranchPicker: React.FC = () => {
  return (
    <BranchPickerPrimitive.Root className="apcot-branch-picker" hideWhenSingleBranch>
      <BranchPickerPrimitive.Previous asChild>
        <button className="apcot-branch-picker-btn" aria-label="Previous version">
          <ChevronLeftIcon />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className="apcot-branch-picker-text">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button className="apcot-branch-picker-btn" aria-label="Next version">
          <ChevronRightIcon />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const UserEditComposer: React.FC = () => {
  return (
    <ComposerPrimitive.Root className="apcot-edit-composer-shell">
      <ComposerPrimitive.Input
        className="apcot-edit-composer-textarea"
        placeholder="Edit message..."
        rows={1}
        autoFocus
      />
      <div className="apcot-edit-composer-actions">
        <ComposerPrimitive.Cancel asChild>
          <button className="apcot-edit-composer-cancel-btn">Cancel</button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button className="apcot-edit-composer-send-btn">Save & Submit</button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

// --------------------------------------------------------------------------
// Unified Collapsible Steps Card (Groups Reasoning & Tools)
// --------------------------------------------------------------------------
interface ThreadMessageStepsProps {
  stepParts: MessagePart[];
  isGenerating: boolean;
}

const ThreadMessageSteps: React.FC<ThreadMessageStepsProps> = ({ stepParts, isGenerating }) => {
  // Keep open during active streaming, collapse automatically on completion
  const [isOpen, setIsOpen] = useState(isGenerating);

  React.useEffect(() => {
    if (!isGenerating) {
      setIsOpen(false);
    }
  }, [isGenerating]);

  const stepCount = stepParts.length;

  // Count how many steps are actually completed (meaningful text or completed tools)
  const completedSteps = stepParts.filter(p => {
    if (p.type === "reasoning") return p.text && p.text.trim().length > 0;
    if (p.type === "tool-call") return p.status === "complete" || p.result;
    return false;
  }).length;
  
  // Identify active step detail
  let activeStepText = "Reasoning...";
  if (stepCount > 0) {
    const lastStep = stepParts[stepCount - 1];
    if (lastStep.type === "tool-call") {
      activeStepText = `Executing ${lastStep.toolName}(...)`;
    }
  }

  return (
    <div className={`apcot-unified-steps-card ${isOpen ? "open" : ""}`}>
      <div 
        className="apcot-unified-steps-header" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <div className="apcot-unified-steps-header-left">
          {isGenerating ? (
            <div className="apcot-steps-loader-container" style={{ gap: "10px" }}>
              <Mirage size={28} color="var(--accent-light)" speed={2.0} />
              <span>
                {completedSteps === 0 
                  ? "Processing..." 
                  : `${completedSteps} ${completedSteps === 1 ? "step" : "steps"} taken`
                }
              </span>
            </div>
          ) : (
            <div className="apcot-steps-complete-container">
              <CheckIcon className="apcot-steps-complete-icon" />
              <span>Took {stepCount} {stepCount === 1 ? "step" : "steps"}</span>
            </div>
          )}
        </div>
        <div className="apcot-unified-steps-header-right">
          {isGenerating ? (
            <span className="apcot-active-step-type">{activeStepText}</span>
          ) : (
            <span className="apcot-active-step-type complete">Completed</span>
          )}
          <div className="apcot-steps-toggle-icon">
            <ChevronDownIcon />
          </div>
        </div>
      </div>
      <div className="apcot-unified-steps-body-wrapper">
        <div className="apcot-unified-steps-body">
          {stepParts.map((part, idx) => {
            const isLast = idx === stepParts.length - 1;
            // Snappy active trace: keep the last/active step open during live streaming,
            // but collapse ALL steps neatly once generation is fully complete.
            const autoCollapse = isGenerating ? !isLast : true;

            if (part.type === "reasoning" && part.text) {
              return <ReasoningBlock key={idx} text={part.text} autoCollapse={autoCollapse} />;
            } else if (part.type === "tool-call" && part.toolName) {
              return (
                <ToolCallBlock
                  key={idx}
                  toolName={part.toolName}
                  args={part.args}
                  result={part.result}
                  status={part.status || (part.result ? "complete" : "running")}
                  autoCollapse={autoCollapse}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------
// Message Renderer router
// --------------------------------------------------------------------------
const ThreadMessage: React.FC = () => {
  const role = useAuiState((s) => s.message.role);
  const content = useAuiState((s) => s.message.content) as MessagePart[];
  const isRunning = useAuiState((s) => s.thread.isRunning);

  if (role === "user") {
    const isEditing = useAuiState((s) => s.message.composer?.isEditing);

    if (isEditing) {
      return (
        <MessagePrimitive.Root className="apcot-msg-root user-msg editing">
          <UserEditComposer />
        </MessagePrimitive.Root>
      );
    }

    return (
      <MessagePrimitive.Root className="apcot-msg-root user-msg">
        <div className="apcot-user-bubble-wrapper">
          <div className="apcot-user-bubble">
            <MessagePrimitive.Parts />
          </div>
          <div className="apcot-user-message-actions">
            <BranchPicker />
            <ActionBarPrimitive.Root className="apcot-message-action-bar">
              <ActionBarPrimitive.Edit asChild>
                <button className="apcot-message-edit-btn" title="Edit Message" aria-label="Edit message">
                  <PencilIcon />
                </button>
              </ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  // 1. Filter out thinking/tool parts from final textual responses
  const stepParts = content ? content.filter(p => p.type === "reasoning" || p.type === "tool-call") : [];
  const outputParts = content ? content.filter(p => p.type === "text") : [];

  // 2. Identify generating state
  const isGenerating = isRunning && (
    stepParts.some(p => p.status === "running") || 
    !outputParts.length || 
    outputParts.some(p => !p.text)
  );

  return (
    <MessagePrimitive.Root className="apcot-msg-root assistant-msg">
      <div className="apcot-assistant-body">
        {/* Render instant initial loading state if we are running but haven't received parts or steps yet */}
        {isGenerating && stepParts.length === 0 && outputParts.length === 0 && (
          <div className="apcot-steps-loader-container" style={{ gap: "10px", padding: "4px 8px" }}>
            <Mirage size={28} color="var(--accent-light)" speed={2.0} />
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Thinking...</span>
          </div>
        )}

        {/* Render unified retractable steps bar if steps are present */}
        {stepParts.length > 0 && (
          <ThreadMessageSteps stepParts={stepParts} isGenerating={isGenerating} />
        )}

        {/* Render final textual message parts */}
        {outputParts.map((part, idx) => (
          part.text && (
            <div key={idx} className="apcot-assistant-text">
              {part.text.split("\n").map((para, pIdx) => (
                <p key={pIdx}>{para}</p>
              ))}
            </div>
          )
        ))}
      </div>
    </MessagePrimitive.Root>
  );
};

// --------------------------------------------------------------------------
// Floating Composer Input Component
// --------------------------------------------------------------------------
const CustomComposer: React.FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return (
    <div className="apcot-composer-container">
      <ComposerPrimitive.Root className="apcot-composer-shell">
        <div className="apcot-composer-input-row">
          <ComposerPrimitive.Input
            className="apcot-composer-textarea"
            placeholder="Ask APCOT Chat..."
            rows={1}
            autoFocus
          />
        </div>
        <div className="apcot-composer-actions">
          <div className="apcot-composer-btn-group">
            <button type="button" className="apcot-composer-tool-btn" aria-label="Attach files">
              <PaperclipIcon />
            </button>
          </div>
          
          {!isRunning ? (
            <ComposerPrimitive.Send asChild>
              <button className="apcot-composer-send-btn" aria-label="Send message">
                <SendIcon />
              </button>
            </ComposerPrimitive.Send>
          ) : (
            <ComposerPrimitive.Cancel asChild>
              <button className="apcot-composer-cancel-btn" aria-label="Stop generation">
                <StopIcon />
              </button>
            </ComposerPrimitive.Cancel>
          )}
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};

// --------------------------------------------------------------------------
// Welcome State Panel (renders inside scrollable Viewport when thread is empty)
// --------------------------------------------------------------------------
interface ThreadWelcomeProps {
  onSendPrompt: (prompt: string) => void;
  starterPrompts?: any[];
}

const ThreadWelcome: React.FC<ThreadWelcomeProps> = ({ onSendPrompt, starterPrompts }) => {
  const suggestions = starterPrompts && starterPrompts.length > 0 ? starterPrompts : [
    {
      title: "Help & Guidelines",
      prompt: "Can you list the guidelines in 'ui-project-bootstrap-guidelines.md'?",
    },
    {
      title: "Knowledge Base Lookup",
      prompt: "Search the knowledge base for APCOT Chat information",
    },
    {
      title: "State Machine Demo",
      prompt: "Show me a demo of your LangGraph thinking and tool executing cycles!",
    },
    {
      title: "Aesthetics Showcase",
      prompt: "Explain how your dark mode glassmorphic UI is styled without Tailwind CSS",
    }
  ];

  return (
    <div className="apcot-welcome-panel">
      <div className="apcot-welcome-icon-box">
        <SparklesIcon />
      </div>
      <h2 className="apcot-welcome-title">Welcome to APCOT Chat</h2>
      <p className="apcot-welcome-desc">
        A premium, high-performance chat interface built with React, TypeScript, 
        and `@assistant-ui/react` primitives. Explore live reasoning traces and 
        interactive tool call executions connected to a Python FastAPI & LangGraph backend.
      </p>

      <div className="apcot-suggestion-grid">
        {suggestions.map((s, idx) => (
          <button
            key={idx}
            className="apcot-suggestion-card"
            onClick={() => onSendPrompt(s.prompt)}
            aria-label={`Send suggestion: ${s.title}`}
          >
            <span className="apcot-suggestion-title">{s.title}</span>
            <span className="apcot-suggestion-prompt">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------
// Core Chat Component integrating Runtime Provider
// --------------------------------------------------------------------------
interface ChatViewportProps {
  runtime: any;
  pendingPrompt: string | null;
  onClearPendingPrompt: () => void;
  starterPrompts?: any[];
}

const ChatViewport: React.FC<ChatViewportProps> = ({ 
  runtime, 
  pendingPrompt, 
  onClearPendingPrompt,
  starterPrompts
}) => {
  const isEmpty = useAuiState((s) => s.thread.isEmpty);

  // Auto-append pending prompt from starters when it mounts or updates
  React.useEffect(() => {
    if (pendingPrompt && runtime) {
      runtime.thread.append(pendingPrompt);
      if (onClearPendingPrompt) {
        onClearPendingPrompt();
      }
    }
  }, [pendingPrompt, runtime]);

  return (
    <ThreadPrimitive.Root className="apcot-chat-layout-root">
      <ThreadPrimitive.Viewport className="apcot-chat-viewport" turnAnchor="top">
        {isEmpty ? (
          <ThreadWelcome onSendPrompt={(prompt) => runtime.thread.append(prompt)} starterPrompts={starterPrompts} />
        ) : (
          <div className="apcot-chat-messages-container">
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>
        )}
      </ThreadPrimitive.Viewport>
      {/* Render composer OUTSIDE viewport scrollable frame to keep it static at bottom */}
      <CustomComposer />
    </ThreadPrimitive.Root>
  );
};

// Helper function to sort messages topologically so that parents are always processed before their children
const sortMessagesTopologically = (messages: any[]): any[] => {
  const sorted: any[] = [];
  const visited = new Set<string>();
  const messageMap = new Map<string, any>();
  
  for (const m of messages) {
    if (m && m.id) {
      messageMap.set(m.id, m);
    }
  }

  const visit = (m: any) => {
    if (!m || visited.has(m.id)) return;
    if (m.parentId && messageMap.has(m.parentId)) {
      visit(messageMap.get(m.parentId));
    }
    visited.add(m.id);
    sorted.push(m);
  };

  for (const m of messages) {
    visit(m);
  }

  return sorted;
};

// --------------------------------------------------------------------------
// Core Chat Component integrating Runtime Provider
// --------------------------------------------------------------------------
export const CustomChat: React.FC<CustomChatProps> = ({ 
  threadId, 
  initialMessages,
  pendingPrompt,
  onClearPendingPrompt,
  onThreadUpdated,
  onDocumentUpdated,
  starterPrompts
}) => {
  // Freeze initialMessages inside local state to block reactive resets from parent re-renders
  const [frozenMessages] = useState(() => initialMessages);

  // Create and configure a local assistant runtime
  const runtime = useLocalRuntime({
    async *run({ messages, abortSignal, unstable_assistantMessageId }) {
      const userMessage = messages[messages.length - 1];
      const userMessageId = userMessage.id;

      // Wait for any unsaved document edits to be saved to the backend
      await new Promise<void>((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            window.removeEventListener("DocumentSaved", onSaved);
            resolve();
          }
        }, 800);

        const onSaved = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            window.removeEventListener("DocumentSaved", onSaved);
            resolve();
          }
        };
        window.addEventListener("DocumentSaved", onSaved);
        window.dispatchEvent(new CustomEvent("RequestSaveDocument"));
      });
      
      // The parent message is the message preceding the newly sent/edited user message
      const parentMessage = messages[messages.length - 2];
      const parentMessageId = parentMessage ? parentMessage.id : null;

      // Use the native ID generated by assistant-ui so frontend and backend are perfectly in sync
      const assistantMessageId = unstable_assistantMessageId || crypto.randomUUID();
      
      // Yield an initial empty array instantly to mount the assistant bubble and show visual feedback
      yield { id: assistantMessageId, content: [] };

      // Grab text from first content part of user message
      let textContent = "";
      if (typeof userMessage.content === "string") {
        textContent = userMessage.content;
      } else if (Array.isArray(userMessage.content) && userMessage.content.length > 0) {
        textContent = userMessage.content[0].text || "";
      }

      // POST to our backend SSE route
      const response = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      if (onThreadUpdated) {
        onThreadUpdated();
      }

      let reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let accumulatedText = "";
      let accumulatedReasoning = "";
      let toolCallInfo: any = null;
      let latestAssistantParts: any[] = [];

      try {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            window.dispatchEvent(new CustomEvent("StreamComplete", {
                detail: {
                    userMessageId: userMessageId,
                    parentId: parentMessageId,
                    userContent: textContent,
                    assistantMessageId: assistantMessageId,
                    assistantParts: latestAssistantParts
                }
            }));
            // Stream completed, notify parent to fetch document in case tool finished
            setTimeout(() => {
              if (onDocumentUpdated) onDocumentUpdated();
            }, 200);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last partial line in buffer
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("event: ")) {
              currentEvent = trimmed.substring(7);
            } else if (trimmed.startsWith("data: ")) {
              const data = trimmed.substring(6);

              if (currentEvent === "requires_action") {
                const tcPayload = JSON.parse(data);
                const toolCalls = tcPayload.tool_calls;
                
                // Wait for frontend execution via global event
                const client_results = await new Promise((resolve) => {
                  const handleToolResult = (e: any) => {
                     window.removeEventListener("FrontendToolResult", handleToolResult);
                     resolve(e.detail.results);
                  };
                  window.addEventListener("FrontendToolResult", handleToolResult);
                  
                  // Tell DocumentWorkspace to execute
                  window.dispatchEvent(new CustomEvent("ExecuteFrontendTool", {
                    detail: { tool_calls: toolCalls }
                  }));
                  
                  // Timeout fallback
                  setTimeout(() => {
                     window.removeEventListener("FrontendToolResult", handleToolResult);
                     resolve(toolCalls.map((tc: any) => ({ id: tc.id, content: "Error: Frontend execution timeout" })));
                  }, 5000);
                });
                
                // Hot-swap the stream by hitting /resume!
                try {
                  const resumeResponse = await fetch(`/api/threads/${threadId}/messages/resume`, {
                     method: "POST",
                     headers: { "Content-Type": "application/json" },
                     body: JSON.stringify({ 
                         client_results, 
                         assistantMessageId, 
                         parentId: parentMessageId 
                     }),
                  });
                  
                  if (resumeResponse.ok && resumeResponse.body) {
                     reader.releaseLock();
                     reader = resumeResponse.body.getReader();
                     currentEvent = "";
                     break; // Break the 'for line of lines' loop to read from the new stream!
                  } else {
                     console.error("Resume failed", resumeResponse.statusText);
                     window.dispatchEvent(new CustomEvent("RollbackFrontendEdits"));
                  }
                } catch (err) {
                  console.error("Resume network error", err);
                }
                continue;
              }
              // data is already declared above

              if (currentEvent === "parts") {
                const parsedParts = JSON.parse(data);
                latestAssistantParts = parsedParts;
                yield { id: assistantMessageId, content: parsedParts };
                continue;
              }

              if (currentEvent === "reasoning") {
                accumulatedReasoning = data;
              } else if (currentEvent === "text") {
                const targetText = data;
                if (!accumulatedText && targetText.length > 30) {
                  // Typewriter-simulate non-streamed text responses on the client side
                  const words = targetText.split(" ");
                  let typedText = "";
                  for (const word of words) {
                    if (typedText) typedText += " ";
                    typedText += word;
                    accumulatedText = typedText;
                    
                    const content: MessagePart[] = [];
                    if (accumulatedReasoning) content.push({ type: "text", text: `<details><summary>Reasoning</summary>\n\n${accumulatedReasoning}\n\n</details>\n\n` });
                    if (toolCallInfo) content.push(toolCallInfo);
                    content.push({ type: "text", text: accumulatedText });
                    latestAssistantParts = content;
                    yield { id: assistantMessageId, content };
                    
                    await new Promise(resolve => setTimeout(resolve, 15));
                  }
                  continue;
                } else {
                  accumulatedText = targetText;
                }
              } else if (currentEvent === "tool-call") {
                const tc = JSON.parse(data);
                toolCallInfo = {
                  type: "tool-call",
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  args: tc.args,
                  status: "running"
                };
              } else if (currentEvent === "tool-response") {
                const tr = JSON.parse(data);
                if (toolCallInfo && toolCallInfo.toolCallId === tr.toolCallId) {
                  toolCallInfo = {
                    ...toolCallInfo,
                    result: tr.result,
                    status: "complete"
                  };
                  // Reactive check: if edit_document completed, notify parent instantly
                  if (toolCallInfo.toolName === "edit_document" && onDocumentUpdated) {
                    onDocumentUpdated();
                  }
                }
              }

              // Build content array
              const content: MessagePart[] = [];
              
              if (accumulatedReasoning) {
                content.push({
                  type: "text",
                  text: `<details><summary>Reasoning</summary>\n\n${accumulatedReasoning}\n\n</details>\n\n`
                });
              }

              if (toolCallInfo) {
                content.push(toolCallInfo);
              }

              if (accumulatedText) {
                content.push({
                  type: "text",
                  text: accumulatedText
                });
              }

              latestAssistantParts = content;
              yield { id: assistantMessageId, content };
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
  }, {});

  // Import the branching conversation tree history on mount
  React.useEffect(() => {
    if (frozenMessages && frozenMessages.length > 0) {
      try {
        const sortedMessages = sortMessagesTopologically(frozenMessages);
        
        // Build a map of all loaded message IDs to detect missing parents
        const messageMap = new Map<string, any>();
        for (const m of frozenMessages) {
          if (m && m.id) {
            messageMap.set(m.id, m);
          }
        }

        const branchableItems = sortedMessages.map((m) => {
          // Self-heal: If parentId refers to a missing message, set it to null to prevent client-side crash
          const parentExists = m.parentId ? messageMap.has(m.parentId) : false;
          return {
            message: {
              id: m.id,
              role: m.role,
              content: m.content
            },
            parentId: parentExists ? m.parentId : null
          };
        });

        const repo = ExportedMessageRepository.fromBranchableArray(branchableItems);
        runtime.thread.import(repo);
      } catch (err) {
        console.error("Error importing branchable messages tree:", err);
      }
    }
  }, [frozenMessages, runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatViewport 
        runtime={runtime}
        pendingPrompt={pendingPrompt}
        onClearPendingPrompt={onClearPendingPrompt}
        starterPrompts={starterPrompts}
      />
    </AssistantRuntimeProvider>
  );
};
