import React, { useState, useEffect, memo } from "react";
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
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { 
  SendIcon, 
  StopIcon, 
  PaperclipIcon, 
  BrainIcon, 
  ChevronDownIcon, 
  SparklesIcon,
  CompassIcon
} from "./Icons";
import { Mirage } from "./loaders";
import { createChatModelAdapter } from "./ChatModelAdapter";
import { EditorTools } from "./ToolRegistry";

// Markdown
const MarkdownTextImpl = () => (
  <MarkdownTextPrimitive
    remarkPlugins={[remarkGfm]}
    className="aui-md"
  />
);
const MarkdownText = memo(MarkdownTextImpl);

// Icons
const PencilIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const ChevronLeftIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const ChevronRightIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

interface CustomChatProps {
  threadId: string;
  initialMessages: any[];
  pendingPrompt: string | null;
  onClearPendingPrompt: () => void;
  onThreadUpdated?: () => void;
  onDocumentUpdated?: () => void;
  starterPrompts?: any[];
}

const BranchPicker = () => (
  <BranchPickerPrimitive.Root className="apcot-branch-picker" hideWhenSingleBranch>
    <BranchPickerPrimitive.Previous asChild>
      <button className="apcot-branch-picker-btn" aria-label="Previous version"><ChevronLeftIcon /></button>
    </BranchPickerPrimitive.Previous>
    <span className="apcot-branch-picker-text">
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next asChild>
      <button className="apcot-branch-picker-btn" aria-label="Next version"><ChevronRightIcon /></button>
    </BranchPickerPrimitive.Next>
  </BranchPickerPrimitive.Root>
);

const UserEditComposer = () => (
  <ComposerPrimitive.Root className="apcot-edit-composer-shell">
    <LexicalComposerInput
      className="apcot-edit-composer-textarea" 
      placeholder="Edit message..." 
    />
    <div className="apcot-edit-composer-actions">
      <ComposerPrimitive.Cancel asChild><button className="apcot-edit-composer-cancel-btn">Cancel</button></ComposerPrimitive.Cancel>
      <ComposerPrimitive.Send asChild><button className="apcot-edit-composer-send-btn">Save & Submit</button></ComposerPrimitive.Send>
    </div>
  </ComposerPrimitive.Root>
);

// Global preference so closed steps stay closed for new messages
let globalStepsOpenPreference = true;

const ReasoningBlock = ({ text }: { text: string }) => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="apcot-reasoning-card" style={{ marginBottom: 8, border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 6, overflow: "hidden", background: "rgba(0, 0, 0, 0.15)" }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", fontSize: "0.8rem", color: "var(--text-secondary)", backgroundColor: "rgba(255, 255, 255, 0.03)", userSelect: "none" }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
           <BrainIcon width={14} height={14} /> 
           <span style={{ fontWeight: 500 }}>Thought Process</span>
        </div>
        <ChevronDownIcon width={14} height={14} style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }} />
      </div>
      <div style={{ 
        display: "grid", 
        gridTemplateRows: isOpen ? "1fr" : "0fr", 
        transition: "grid-template-rows 0.3s ease-in-out" 
      }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace", whiteSpace: "pre-wrap", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
            {text}
          </div>
        </div>
      </div>
    </div>
  );
};

const ThreadMessage = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer?.isEditing);

  const [masterOpen, setMasterOpen] = useState(globalStepsOpenPreference);
  const toggleMaster = () => {
    const newVal = !masterOpen;
    setMasterOpen(newVal);
    globalStepsOpenPreference = newVal;
  };

  const isRunning = useAuiState((s) => s.thread.isRunning);
  const isLast = useAuiState((s) => {
    const msgs = s?.thread?.messages;
    return msgs && msgs.length > 0 && msgs[msgs.length - 1]?.id === s?.message?.id;
  });

  const content = useAuiState((s) => s.message.content) || [];
  const stepParts = content.filter((p: any) => p.type === "reasoning" || p.type === "tool-call");
  
  const hasSteps = stepParts.length > 0;
  const isThinking = content.length === 0 && isRunning && isLast;
  const shouldShowBar = hasSteps || isThinking;

  let summaryLeft = null;
  let summaryRight = null;

  if (isThinking) {
     summaryLeft = (
       <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
         <Mirage size={14} color="var(--accent-light)" speed={2.0} />
         <span>Initializing thought process...</span>
       </div>
     );
  } else if (hasSteps) {
     const nSteps = stepParts.length;
     const lastStep = stepParts[nSteps - 1];
     let stepName = "";
     if (lastStep.type === "reasoning") stepName = "Reasoning";
     if (lastStep.type === "tool-call") stepName = lastStep.toolName;

     const isStepRunning = isRunning && isLast;
     
     summaryLeft = (
       <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
         {isStepRunning ? <Mirage size={14} color="var(--accent-light)" speed={2.0} /> : <CompassIcon width={16} height={16} />}
         <span>{nSteps} step{nSteps > 1 ? "s" : ""} taken</span>
       </div>
     );
     
     if (isStepRunning) {
        summaryRight = (
          <span style={{ fontSize: "0.75rem", color: "var(--accent-light)", fontWeight: 500 }}>
             {stepName}...
          </span>
        );
     }
  }

  if (role === "user") {
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
            <MessagePrimitive.Parts>
              {({ part }) => (part.type === "text" ? <>{part.text}</> : null)}
            </MessagePrimitive.Parts>
          </div>
          <div className="apcot-user-message-actions">
            <BranchPicker />
            <ActionBarPrimitive.Root className="apcot-message-action-bar">
              <ActionBarPrimitive.Edit asChild>
                <button className="apcot-message-edit-btn" title="Edit"><PencilIcon /></button>
              </ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  // Assistant Message
  return (
    <MessagePrimitive.Root className="apcot-msg-root assistant-msg">
      <div className="apcot-assistant-body">
        
        {shouldShowBar && (
          <div 
            className="apcot-master-steps" 
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              backdropFilter: "blur(32px) saturate(200%)",
              WebkitBackdropFilter: "blur(32px) saturate(200%)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
              borderRadius: "12px",
              marginBottom: "16px",
              overflow: "hidden"
            }}
          >
            <div 
              onClick={toggleMaster}
              style={{
                cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)",
                background: "rgba(255, 255, 255, 0.03)", borderBottom: masterOpen ? "1px solid rgba(255, 255, 255, 0.05)" : "none",
                userSelect: "none"
              }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {summaryLeft}
              </div>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                {!masterOpen && summaryRight}
                <ChevronDownIcon width={16} height={16} style={{ transform: masterOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }} />
              </div>
            </div>
            <div style={{ 
              display: "grid", 
              gridTemplateRows: masterOpen ? "1fr" : "0fr", 
              transition: "grid-template-rows 0.3s ease-in-out" 
            }}>
              <div style={{ overflow: "hidden" }}>
                <div style={{ padding: "12px 12px 4px 12px" }}>
                  <MessagePrimitive.Parts>
                    {({ part }) => {
                      if (part.type === "reasoning") {
                        return part.text ? <ReasoningBlock text={part.text} /> : (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", marginBottom: 8, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                            <Mirage size={14} color="var(--accent-light)" speed={2.0} />
                            <span>Thinking...</span>
                          </div>
                        );
                      }
                      if (part.type === "tool-call") {
                        return part.toolUI;
                      }
                      return null;
                    }}
                  </MessagePrimitive.Parts>
                </div>
              </div>
            </div>
          </div>
        )}

        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === "text") {
              return <MarkdownText />;
            }
            return null;
          }}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
};

import { LexicalComposerInput } from "@assistant-ui/react-lexical";

const CustomComposer = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);

  return (
    <div className="apcot-composer-container">
      <ComposerPrimitive.Root className="apcot-composer-shell">
        <div className="apcot-composer-input-row">
          <LexicalComposerInput
            className="apcot-composer-textarea" 
            placeholder="Ask APCOT Chat..." 
          />
        </div>
        <div className="apcot-composer-actions">
          <div className="apcot-composer-btn-group">
            <button type="button" className="apcot-composer-tool-btn"><PaperclipIcon /></button>
          </div>
          {!isRunning ? (
            <ComposerPrimitive.Send asChild><button className="apcot-composer-send-btn"><SendIcon /></button></ComposerPrimitive.Send>
          ) : (
            <ComposerPrimitive.Cancel asChild><button className="apcot-composer-cancel-btn"><StopIcon /></button></ComposerPrimitive.Cancel>
          )}
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};

const ThreadWelcome = ({ onSendPrompt, starterPrompts }: any) => {
  const suggestions = starterPrompts || [
    { title: "Help & Guidelines", prompt: "Can you list the guidelines in 'ui-project-bootstrap-guidelines.md'?" },
    { title: "Aesthetics Showcase", prompt: "Explain how your dark mode glassmorphic UI is styled without Tailwind CSS" }
  ];
  return (
    <div className="apcot-welcome-panel">
      <div className="apcot-welcome-icon-box"><SparklesIcon /></div>
      <h2 className="apcot-welcome-title">Welcome to APCOT Chat</h2>
      <p className="apcot-welcome-desc">A premium, high-performance chat interface rebuilt with `@assistant-ui/react` primitives.</p>
      <div className="apcot-suggestion-grid">
        {suggestions.map((s: any, idx: number) => (
          <button key={idx} className="apcot-suggestion-card" onClick={() => onSendPrompt(s.prompt)}>
            <span className="apcot-suggestion-title">{s.title}</span>
            <span className="apcot-suggestion-prompt">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const ChatViewport = ({ runtime, pendingPrompt, onClearPendingPrompt, starterPrompts }: any) => {
  const isEmpty = useAuiState((s) => s.thread.isEmpty);

  useEffect(() => {
    if (pendingPrompt && runtime) {
      runtime.thread.append(pendingPrompt);
      if (onClearPendingPrompt) onClearPendingPrompt();
    }
  }, [pendingPrompt, runtime]);

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <ThreadPrimitive.Root className="apcot-chat-layout-root" style={{ flex: 1 }}>
        <ThreadPrimitive.Viewport className="apcot-chat-viewport" turnAnchor="top">
          {isEmpty ? (
            <ThreadWelcome onSendPrompt={(prompt: string) => runtime.thread.append(prompt)} starterPrompts={starterPrompts} />
          ) : (
            <div className="apcot-chat-messages-container">
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage />}
              </ThreadPrimitive.Messages>
            </div>
          )}
        </ThreadPrimitive.Viewport>
        <CustomComposer />
      </ThreadPrimitive.Root>
    </div>
  );
};

// Main Export
export const CustomChat: React.FC<CustomChatProps> = ({ 
  threadId, 
  initialMessages,
  pendingPrompt,
  onClearPendingPrompt,
  onThreadUpdated,
  starterPrompts
}) => {
  const [frozenMessages] = useState(() => initialMessages);

  // useLocalRuntime is bound to our extracted ChatModelAdapter
  const runtime = useLocalRuntime({
    run: createChatModelAdapter(threadId, onThreadUpdated)
  });

  // Import history using ExportedMessageRepository to properly handle backend DB schema
  useEffect(() => {
    if (frozenMessages && frozenMessages.length > 0) {
      try {
        const branchableItems = frozenMessages
          .filter((m) => m && m.id)
          .map((m) => ({
            message: { id: m.id, role: m.role, content: m.content },
            parentId: m.parentId || null
          }));
        const repo = ExportedMessageRepository.fromBranchableArray(branchableItems);
        runtime.thread.import(repo);
      } catch (err) {
        console.error("Error importing messages:", err);
      }
    }
  }, [frozenMessages, runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <EditorTools />
      <ChatViewport 
        runtime={runtime}
        pendingPrompt={pendingPrompt}
        onClearPendingPrompt={onClearPendingPrompt}
        starterPrompts={starterPrompts}
      />
    </AssistantRuntimeProvider>
  );
};
