// Firewall AI Assistant  - Executor\frontend\src\components\BackendLogViewer.tsx
import React, { useEffect, useRef } from 'react';
import './BackendLogViewer.css'; 

interface BackendLogViewerProps {
  logs: string[];
}

const BackendLogViewer: React.FC<BackendLogViewerProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      // Auto-scroll to bottom only if the user isn't scrolled up
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isScrolledToBottom = scrollHeight - scrollTop <= clientHeight + 20; // Add a small threshold
      if (isScrolledToBottom) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [logs]);

  return (
    // The outer container (.backend-log-viewer-container) is styled in CenterArea.css
    // This component provides its internal structure.
    <> 
      <div className="log-header">
        <span>Backend Server Logs</span>
        {/* Placeholder for future buttons like clear/copy */}
      </div>
      <div className="log-content" ref={scrollRef}>
        {logs.length === 0 ? (
          <pre className="log-line log-placeholder">No logs to display.</pre>
        ) : (
          logs.map((log, index) => (
            <pre key={index} className="log-line">
              {log}
            </pre>
          ))
        )}
      </div>
    </>
  );
};

export default BackendLogViewer;