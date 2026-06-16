import React, { useState } from "react";
import { 
  PlusIcon, 
  TrashIcon, 
  SparklesIcon 

} from "./Icons";

interface Thread {
  id: string;
  title: string;
  created_at: string;
}

interface SidebarProps {
  threads: Thread[];
  currentThreadId: string | null;
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
  onDeleteThread: (id: string, e: React.MouseEvent) => void;
  isMobileOpen: boolean;
  userProfile?: any;
  ssoLogoutUrl?: string;
}

// Custom inline SVGs for Sidebar Collapse
const CollapseLeftIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
    <path d="M18 6L12 12L18 18" />
    <path d="M12 6L6 12L12 18" />
  </svg>
);

const SearchIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const LogOutIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const Sidebar: React.FC<SidebarProps> = ({
  threads,
  currentThreadId,
  onSelectThread,
  onCreateThread,
  onDeleteThread,
  isMobileOpen,
  userProfile,
  ssoLogoutUrl
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const displayName = userProfile?.fullname || userProfile?.uid || "Beyond";
  const displayRole = userProfile?.email || "Developer";
  const initials = displayName
    .split(" ")
    .map((n: string) => n ? n[0] : "")
    .join("")
    .substring(0, 2)
    .toUpperCase() || "B";

  const handleLogout = () => {
    const logoutTarget = ssoLogoutUrl || "http://localhost:5001/logout";
    window.location.href = `${logoutTarget}?redirect=${encodeURIComponent(window.location.origin)}`;
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleSidebarClick = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
    }
  };

  // Filter threads by search query
  const filteredThreads = threads.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside 
      className={`apcot-sidebar ${isCollapsed ? "collapsed" : ""} ${isMobileOpen ? "open" : ""}`}
      onClick={handleSidebarClick}
      style={{ cursor: isCollapsed ? "pointer" : "default" }}
    >
      {/* Brand Header */}
      <div className="apcot-sidebar-header">
        {!isCollapsed && (
          <div 
            className="apcot-logo-section" 
            onClick={(e) => {
              if (isCollapsed) {
                e.stopPropagation();
                setIsCollapsed(false);
              }
            }}
          >
            <div className="apcot-logo-icon">
              <SparklesIcon />
            </div>
            <span className="apcot-logo-text">APCOT Chat</span>
          </div>
        )}
        
        <button 
          className="apcot-sidebar-collapse-btn" 
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapse();
          }}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={isCollapsed ? { margin: "0 auto" } : {}}
        >
          <CollapseLeftIcon style={{ transform: isCollapsed ? "rotate(180deg)" : "none" }} />
        </button>
      </div>

      <div className="apcot-new-chat-wrapper">
        {isCollapsed ? (
          <button 
            className="apcot-new-chat-btn-mini" 
            onClick={(e) => {
              e.stopPropagation();
              onCreateThread();
            }}
            title="New Chat"
            aria-label="Create new conversation thread"
          >
            <PlusIcon />
          </button>
        ) : (
          <button 
            className="apcot-new-chat-btn" 
            onClick={(e) => {
              e.stopPropagation();
              onCreateThread();
            }}
            aria-label="Create new conversation thread"
          >
            <PlusIcon />
            <span className="apcot-new-chat-text">New Chat</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="apcot-search-wrapper">
        {isCollapsed ? (
          <button 
            className="apcot-search-btn-mini"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(false); // Expand search when clicked
            }}
            title="Search Chats"
          >
            <SearchIcon />
          </button>
        ) : (
          <div className="apcot-search-bar" onClick={(e) => e.stopPropagation()}>
            <SearchIcon />
            <input 
              id="sidebar-search-conversations"
              name="searchQuery"
              type="text" 
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search conversation threads"
            />
          </div>
        )}
      </div>

      {/* Scrollable Threads List - HIDE COMPLETELY in collapsed mini mode */}
      {!isCollapsed ? (
        <div className="apcot-sidebar-threads" onClick={(e) => e.stopPropagation()}>
          <div className="apcot-thread-list-title">Recent Conversations</div>
          
          {filteredThreads.length === 0 ? (
            <div style={{ padding: "20px 12px", textAlign: "center", color: "var(--text-dark)", fontSize: "0.75rem" }}>
              No chats found
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const isActive = thread?.id === currentThreadId;
              return (
                <div
                  key={thread?.id}
                  className={`apcot-thread-row ${isActive ? "active" : ""}`}
                  onClick={() => onSelectThread(thread?.id)}
                >
                  <div className="apcot-thread-info">
                    <span className="apcot-thread-title" title={thread.title}>
                      {thread.title}
                    </span>
                  </div>
                  
                  <button
                    className="apcot-thread-delete-btn"
                    onClick={(e) => onDeleteThread(thread?.id, e)}
                    aria-label={`Delete thread ${thread.title}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="apcot-sidebar-spacer" style={{ flex: 1 }} />
      )}

      {/* Footer Profile Info */}
      <div className="apcot-sidebar-footer">
        {/* Expanded Mode Card */}
        <div className="apcot-user-card" onClick={(e) => e.stopPropagation()}>
          <div className="apcot-user-details">
            <div className="apcot-user-avatar">
              {initials}
            </div>
            <div className="apcot-user-info-text">
              <span className="apcot-user-name" title={displayName}>{displayName}</span>
              <span className="apcot-user-role" title={displayRole}>{displayRole}</span>
            </div>
          </div>
          <button 
            className="apcot-user-settings-btn" 
            onClick={(e) => { e.stopPropagation(); handleLogout(); }} 
            aria-label="Sign Out"
            title="Sign Out"
          >
            <LogOutIcon />
          </button>
        </div>

        {/* Collapsed Mode Card */}
        <div className="apcot-sidebar-mini-footer">
          <div 
            className="apcot-user-avatar" 
            title={`${displayName} (${displayRole})`}
          >
            {initials}
          </div>
          <button 
            className="apcot-user-settings-btn" 
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
            aria-label="Sign Out" 
            title="Sign Out"
          >
            <LogOutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
};
