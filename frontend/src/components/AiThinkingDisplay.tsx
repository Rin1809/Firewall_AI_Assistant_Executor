// frontend/src/components/AiThinkingDisplay.tsx
import React, { useState } from 'react';
import { FiChevronDown, FiChevronRight, FiTool, FiCheckCircle, FiAlertCircle, FiCpu } from 'react-icons/fi';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { AiThought } from '../App'; // Import kieu
import './AiThinkingDisplay.css'; // Tao file CSS moi

interface AiThinkingDisplayProps {
    thoughts: AiThought[];
    blockIdSuffix?: string; // De tao ID duy nhat cho aria-controls
}

const formatThoughtTimestamp = (isoString: string): string => {
    try { return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
    catch { return ''; }
};

const AiThinkingDisplay: React.FC<AiThinkingDisplayProps> = ({ thoughts, blockIdSuffix }) => {
    const [isExpanded, setIsExpanded] = useState(true); // Mac dinh mo

    if (!thoughts || thoughts.length === 0) return null;

    // Dem so buoc (1 request + 1 result = 1 buoc)
    const stepCount = Math.ceil(thoughts.filter(th => th.type === 'function_call_request').length);
    const displayBlockId = `thinking-details-${blockIdSuffix || 'default'}`;

    return (
        <div className="ai-thinking-container">
            <button
                className="thinking-toggle-button"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                aria-controls={displayBlockId}
            >
                {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
                <FiCpu style={{ marginRight: '6px', color: 'var(--text-accent)'}} />
                <span>AI đã thực hiện {stepCount > 0 ? `${stepCount} bước` : ''} suy nghĩ/gọi tool</span>
            </button>
            {isExpanded && (
                <div id={displayBlockId} className="thinking-details-list">
                    {thoughts.map((thought, index) => (
                        <div key={`${displayBlockId}-thought-${index}`} className={`thought-item thought-type-${thought.type} ${thought.is_error ? 'error' : ''}`}>
                            <div className="thought-header">
                                {thought.type === 'function_call_request' && <FiTool className="thought-icon tool-request-icon" title="AI yêu cầu gọi tool"/>}
                                {thought.type === 'function_call_result' && thought.is_error && <FiAlertCircle className="thought-icon tool-result-icon error" title="Kết quả tool (Lỗi)"/>}
                                {thought.type === 'function_call_result' && !thought.is_error && <FiCheckCircle className="thought-icon tool-result-icon success" title="Kết quả tool (Thành công)"/>}
                                <span className="thought-title">
                                    {thought.type === 'function_call_request' ? `Gọi Tool: ${thought.tool_name}` : `Kết quả Tool: ${thought.tool_name}`}
                                </span>
                                <span className="thought-timestamp">{formatThoughtTimestamp(thought.timestamp)}</span>
                            </div>
                            <div className="thought-content">
                                {thought.type === 'function_call_request' && thought.tool_args && Object.keys(thought.tool_args).length > 0 && (
                                    <SyntaxHighlighter language="json" style={vscDarkPlus as any} className="thought-code-block" PreTag="div">
                                        {JSON.stringify(thought.tool_args, null, 2)}
                                    </SyntaxHighlighter>
                                )}
                                {thought.type === 'function_call_result' && thought.result_data != null && ( // Ktra ca null/undefined
                                    thought.result_data && typeof thought.result_data === 'string' && thought.result_data.length > 300 ? (
                                        <details className="thought-result-details">
                                            <summary>Kết quả quá dài, nhấn để xem ({thought.result_data.length} ký tự)</summary>
                                            <pre className="thought-pre-block">{thought.result_data}</pre>
                                        </details>
                                    ) : (
                                        <pre className="thought-pre-block">{String(thought.result_data)}</pre>
                                    )
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AiThinkingDisplay;