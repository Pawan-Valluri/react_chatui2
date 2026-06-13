import React, { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { Workspace } from "./components/Workspace";
import { DocumentWorkspace } from "./components/DocumentWorkspace";
import "./styles/App.scss";

interface Thread {
  id: string;
  title: string;
  created_at: string;
}

export interface AppProps {
  config?: {
    enableSSO?: boolean;
    ssoLoginUrl?: string;
    ssoLogoutUrl?: string;
  };
}

export function App({ config }: AppProps = {}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [currentThreadMessages, setCurrentThreadMessages] = useState<any[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [starterPrompts, setStarterPrompts] = useState<any[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("apcot-theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });

  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(true);
  const [workspaceWidth, setWorkspaceWidth] = useState(450);
  const [documentRevision, setDocumentRevision] = useState(0);

  // Auto-expand Workspace when a thread is loaded/selected
  useEffect(() => {
    if (currentThreadId) {
      setIsWorkspaceCollapsed(false);
      setDocumentRevision(0); // Reset revision on thread change
    }
  }, [currentThreadId]);

  // Keep HTML attribute and localStorage in sync with theme state
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("apcot-theme", theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Configure optional SSO redirect
  const enableSSO = config?.enableSSO !== undefined 
    ? config.enableSSO 
    : (import.meta.env.VITE_ENABLE_SSO !== "false");
    
  const ssoLoginUrl = config?.ssoLoginUrl 
    || import.meta.env.VITE_SSO_LOGIN_URL 
    || "http://localhost:5001/login";

  const ssoLogoutUrl = config?.ssoLogoutUrl
    || import.meta.env.VITE_SSO_LOGOUT_URL
    || "http://localhost:5001/logout";

  // Check user session on mount
  useEffect(() => {
    checkSession();
  }, []);

  const fetchStarterPrompts = async () => {
    try {
      const res = await fetch("/api/starter-prompts");
      if (res.ok) {
        const data = await res.json();
        setStarterPrompts(data);
      }
    } catch (err) {
      console.error("Error fetching starter prompts:", err);
    }
  };

  const checkSession = async () => {
    try {
      const res = await fetch("/v1/user/userinfo");
      if (res.ok) {
        const data = await res.json();
        setUserProfile(data);
        setIsAuthenticating(false);
        // Load threads once authenticated
        fetchThreads();
        fetchStarterPrompts();
      } else if (res.status === 401) {
        if (enableSSO) {
          // Redirect browser to AuthBlue SSO login page
          window.location.href = `${ssoLoginUrl}?redirect=${encodeURIComponent(window.location.href)}`;
        } else {
          // Fallback to mock dev session if SSO disabled
          setUserProfile({
            uid: "beyond_dev",
            fullname: "Beyond Developer",
            email: "beyond.developer@aexp.com"
          });
          setStarterPrompts([
            {
              title: "Help & Guidelines",
              prompt: "Can you list the guidelines in 'ui-project-bootstrap-guidelines.md'?"
            },
            {
              title: "Knowledge Base Lookup",
              prompt: "Search the knowledge base for APCOT Chat information"
            },
            {
              title: "State Machine Demo",
              prompt: "Show me a demo of your LangGraph thinking and tool executing cycles!"
            },
            {
              title: "Aesthetics Showcase",
              prompt: "Explain how your dark mode glassmorphic UI is styled without Tailwind CSS"
            }
          ]);
          setIsAuthenticating(false);
          fetchThreads();
        }
      } else {
        console.error("AuthCheck returned status:", res.status);
        setIsAuthenticating(false);
      }
    } catch (err) {
      console.error("Failed to authenticate session:", err);
      setIsAuthenticating(false);
    }
  };

  // Fetch conversation messages when currentThreadId changes
  useEffect(() => {
    if (currentThreadId) {
      fetchMessages(currentThreadId);
    } else {
      setCurrentThreadMessages([]);
    }
  }, [currentThreadId]);

  const fetchThreads = async () => {
    try {
      const res = await fetch("/api/threads");
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
        if (data.length > 0) {
          if (!currentThreadId) {
            setCurrentThreadId(data[0].id);
          }
        } else {
          // Auto create a thread if DB has no conversations
          handleCreateThread();
        }
      }
    } catch (err) {
      console.error("Error fetching threads:", err);
    }
  };

  const fetchMessages = async (threadId: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setCurrentThreadMessages(data);
      }
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleCreateThread = async () => {
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (res.ok) {
        const newThread = await res.json();
        setThreads((prev) => [newThread, ...prev]);
        setCurrentThreadId(newThread.id);
        setIsMobileOpen(false);
      }
    } catch (err) {
      console.error("Error creating thread:", err);
    }
  };

  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setThreads((prev) => {
          const updated = prev.filter((t) => t.id !== threadId);
          if (currentThreadId === threadId) {
            if (updated.length > 0) {
              setCurrentThreadId(updated[0].id);
            } else {
              setCurrentThreadId(null);
              handleCreateThread();
            }
          }
          return updated;
        });
      }
    } catch (err) {
      console.error("Error deleting thread:", err);
    }
  };

  const handleSendFirstMessage = (prompt: string) => {
    // Save prompt text to state; CustomChat will append it to local runtime on mount
    setPendingPrompt(prompt);
  };

  if (isAuthenticating) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg-dark)",
        color: "var(--text-primary)"
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          border: "3px solid rgba(1, 111, 208, 0.1)",
          borderTopColor: "#016fd0",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          marginBottom: "16px"
        }} />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <span style={{ fontSize: "0.85rem", color: "var(--text-dark)", letterSpacing: "0.5px" }}>
          Authenticating via AuthBlue SSO...
        </span>
      </div>
    );
  }

  return (
    <div className="apcot-app-shell">
      {/* Left Sidebar */}
      <Sidebar
        threads={threads}
        currentThreadId={currentThreadId}
        onSelectThread={setCurrentThreadId}
        onCreateThread={handleCreateThread}
        onDeleteThread={handleDeleteThread}
        isMobileOpen={isMobileOpen}
        userProfile={userProfile}
        ssoLogoutUrl={ssoLogoutUrl}
      />

      {/* Main Chat View */}
      <ChatArea
        currentThreadId={currentThreadId}
        currentThreadMessages={currentThreadMessages}
        threads={threads}
        onSendFirstMessage={handleSendFirstMessage}
        isLoadingMessages={isLoadingMessages}
        pendingPrompt={pendingPrompt}
        onClearPendingPrompt={() => setPendingPrompt(null)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onThreadUpdated={fetchThreads}
        onDocumentUpdated={() => setDocumentRevision(prev => prev + 1)}
        starterPrompts={starterPrompts}
      />

      {/* Workspace Panel */}
      <Workspace
        isCollapsed={isWorkspaceCollapsed}
        onToggleCollapse={() => setIsWorkspaceCollapsed((prev) => !prev)}
        width={workspaceWidth}
        onWidthChange={setWorkspaceWidth}
      >
        {currentThreadId && (
          <DocumentWorkspace
            threadId={currentThreadId!}
            userProfile={userProfile}
            width={workspaceWidth}
            documentRevision={documentRevision}
          />
        )}
      </Workspace>

    </div>
  );
}
export default App;
