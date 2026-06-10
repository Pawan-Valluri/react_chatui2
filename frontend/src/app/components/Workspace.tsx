import React, { useRef, useEffect, useState } from "react";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { Orbit } from "./loaders";

interface WorkspaceProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  children?: React.ReactNode;
  savingStatus?: "idle" | "saving" | "saved";
}

export const Workspace: React.FC<WorkspaceProps> = ({
  isCollapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  children,
  savingStatus = "idle",
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = window.innerWidth - e.clientX;
      
      const minLimit = Math.max(320, window.innerWidth * 0.2);
      const maxLimit = window.innerWidth * 0.6;
      
      if (newWidth >= minLimit && newWidth <= maxLimit) {
        onWidthChange(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, onWidthChange]);

  return (
    <>
      {/* Mid-edge Toggle Button */}
      <button
        className={`workspace-edge-toggle ${isCollapsed ? "collapsed" : ""}`}
        style={{ right: isCollapsed ? 0 : width }}
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "Open Workspace" : "Close Workspace"}
        title={isCollapsed ? "Open Workspace" : "Close Workspace"}
      >
        {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      <aside
        className={`apcot-workspace-panel ${isCollapsed ? "collapsed" : ""} ${isResizing ? "resizing" : ""}`}
        style={{ width: isCollapsed ? 0 : width }}
      >
        {/* Draggable handle for resizing */}
        {!isCollapsed && (
          <div
            ref={resizeRef}
            className={`workspace-resize-handle ${isResizing ? "dragging" : ""}`}
            onMouseDown={startResizing}
          />
        )}

        {/* Header */}
        {!isCollapsed && (
          <div className="workspace-header">
            <div className="workspace-header-title">
              <Sparkles size={16} style={{ color: "var(--accent-light)" }} />
              Workspace
              <span className="workspace-header-subtitle">Panel</span>
            </div>
            
            <div className="autosync-status-container">
              {savingStatus === "saving" && (
                <div className="autosync-status saving">
                  <Orbit size={18} color="var(--accent-light)" speed={1.5} />
                  <span className="tooltip-text">Autosaving edits...</span>
                </div>
              )}
              {savingStatus === "saved" && (
                <div className="autosync-status saved">
                  <div className="sync-dot green" />
                  <span className="tooltip-text">Saved to backend</span>
                </div>
              )}
              {savingStatus === "idle" && (
                <div className="autosync-status idle">
                  <div className="sync-dot grey" />
                  <span className="tooltip-text">Connected & In Sync</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content area */}
        {!isCollapsed && (
          <div className="workspace-content">
            {children ? (
              children
            ) : (
              <div className="workspace-empty-state">
                <Sparkles className="workspace-empty-icon" />
                <div className="workspace-empty-title">Ready for Action</div>
                <p className="workspace-empty-desc">
                  This is your dynamic companion panel. When the agent acts or when steps/sources are loaded, details will render here.
                </p>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
};
export default Workspace;
