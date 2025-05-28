// Firewall AI Assistant  - Executor\frontend\src\components\BackendLogViewer.tsx
import React, { useEffect, useRef } from 'react';
import './BackendLogViewer.css'; // Make sure this CSS is imported

interface BackendLogViewerProps {
  logs: string[];
}

// Helper comp cho tung dong log
interface LogLineProps {
  log: string;
}

const LogLine: React.FC<LogLineProps> = ({ log }) => {
  // Regex de parse log format: "2024-07-30 10:00:00,123 INFO: message [in /path/to/file.py:123]"
  const match = log.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(INFO|WARNING|ERROR|DEBUG|CRITICAL):\s+(.*?)\s+\[in\s+(.+?):(\d+)]$/);

  if (!match) {
    // Fallback cho dong ko dung format
    return <pre className="log-line log-unparsed">{log}</pre>;
  }

  const [_, timestampWithMs, level, message, filePath, lineNumber] = match;
  const timestamp = timestampWithMs.split(',')[0]; // Bo ms de display gon hon
  
  // Lay ten file tu full path (ho tro ca / va \)
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const levelClass = `log-level-${level.toLowerCase()}`;

  return (
    <pre className={`log-line ${levelClass}`}>
      <span className="log-timestamp">{timestamp}</span>
      <span className={`log-level ${levelClass}`}>{level}</span>
      <span className="log-message">{message.trim()}</span>
      <span className="log-location">({fileName}:{lineNumber})</span>
    </pre>
  );
};


const BackendLogViewer: React.FC<BackendLogViewerProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      // Auto-scroll to bottom chi khi user ko scroll len
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isScrolledToBottom = scrollHeight - scrollTop <= clientHeight + 20; // Them threshold nho
      if (isScrolledToBottom) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [logs]);

  return (
    // Outer container (.backend-log-viewer-container) style o CenterArea.css
    // Comp nay cung cap cau truc noi bo
    <> 
      <div className="log-header">
        <span>Backend Server Logs</span>
        {/* Placeholder cho buttons (clear/copy) */}
      </div>
      <div className="log-content" ref={scrollRef}>
        {logs.length === 0 ? (
          <pre className="log-line log-placeholder">No logs to display.</pre>
        ) : (
          logs.map((log, index) => (
            <LogLine key={index} log={log} />
          ))
        )}
      </div>
    </>
  );
};

export default BackendLogViewer;