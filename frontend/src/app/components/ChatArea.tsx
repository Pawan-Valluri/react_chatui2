import React from "react";
import { CustomChat } from "./CustomChat";
import { Sun, Moon, Sparkles } from "lucide-react";
import { Mirage } from "./loaders";

interface Thread {
  id: string;
  title: string;
  created_at: string;
}

interface ChatAreaProps {
  currentThreadId: string | null;
  currentThreadMessages: any[];
  threads: Thread[];
  onSendFirstMessage: (text: string) => void;
  isLoadingMessages: boolean;
  pendingPrompt: string | null;
  onClearPendingPrompt: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onThreadUpdated?: () => void;
  onDocumentUpdated?: () => void;
  starterPrompts?: any[];
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  currentThreadId,
  currentThreadMessages,
  threads,
  isLoadingMessages,
  pendingPrompt,
  onClearPendingPrompt,
  theme,
  onToggleTheme,
  onThreadUpdated,
  onDocumentUpdated,
  starterPrompts
}) => {
  const activeThread = threads.find((t: any) => t?.id === currentThreadId);

  return (
    <main className="apcot-main-container">
      {/* Top Header */}
      <header className="apcot-chat-header">
        <div className="apcot-chat-header-title">
          {activeThread ? activeThread.title : "APCOT Chat"}
          <span className="apcot-chat-header-subtitle">
            {activeThread ? "• Active Session" : "• Loading..."}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Theme Switcher Button */}
          <button
            onClick={onToggleTheme}
            className="apcot-theme-toggle-btn"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>


      {/* Main viewport area */}
      {isLoadingMessages ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: "16px" }}>
          <Mirage size={45} color="var(--accent-light)" speed={2.2} />
          <span style={{ fontSize: "0.85rem", letterSpacing: "0.2px", marginTop: "4px" }}>Loading messages...</span>
        </div>
      ) : !currentThreadId ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: "16px", padding: "20px", textAlign: "center" }}>
          <Sparkles size={32} style={{ color: "var(--accent-light)", opacity: 0.6 }} />
          <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--text-secondary)" }}>No conversation selected</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", maxWidth: "320px", lineHeight: "1.5" }}>
            Select an existing conversation from the sidebar or create a new one to begin.
          </span>
        </div>
      ) : (
        // Key-reset on threadId changes force full reload of assistant useLocalRuntime
        <CustomChat 
          key={currentThreadId} 
          threadId={currentThreadId} 
          initialMessages={currentThreadMessages} 
          pendingPrompt={pendingPrompt}
          onClearPendingPrompt={onClearPendingPrompt}
          onThreadUpdated={onThreadUpdated}
          onDocumentUpdated={onDocumentUpdated}
          starterPrompts={starterPrompts}
        />
      )}
    </main>
  );
};
