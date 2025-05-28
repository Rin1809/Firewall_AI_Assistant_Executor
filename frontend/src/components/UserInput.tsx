// frontend/src/components/UserInput.tsx
import React, { KeyboardEvent, useRef, useEffect } from 'react';
import { FiSend, FiTool, FiMessageSquare } from 'react-icons/fi'; // Them FiMessageSquare
import { TargetOS } from '../App';
import './UserInput.css';

interface UserInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onPrimarySubmit: () => void;
  isLoading: boolean;
  targetOs: TargetOS;
  isFortiGateInteractiveMode: boolean;
  onToggleFortiGateInteractiveMode: () => void;
}

const UserInput: React.FC<UserInputProps> = ({
  prompt,
  setPrompt,
  onPrimarySubmit,
  isLoading,
  targetOs,
  isFortiGateInteractiveMode,
  onToggleFortiGateInteractiveMode,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 200;
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
      textareaRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [prompt]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey && !isLoading && prompt.trim()) {
      e.preventDefault();
      onPrimarySubmit();
    }
  };

  const getPlaceholderText = () => {
      if (targetOs === 'fortios') {
          return isFortiGateInteractiveMode
            ? "Nhập yêu cầu tạo lệnh/cấu hình FortiGate (AI có thể gọi tool lấy thông tin)..."
            : "Chat với FortiAI về FortiGate (AI có thể gọi tool lấy thông tin)...";
      }
      return "Nhập yêu cầu (Ctrl+Enter để gửi)...";
  };

  return (
    <div className="user-input-container">
      <div className="user-input-area">
        <div className={`input-suggestion-chips ${targetOs === 'fortios' ? 'visible' : ''}`}>
          {targetOs === 'fortios' && (
              <button
                onClick={onToggleFortiGateInteractiveMode}
                disabled={isLoading}
                className={`suggestion-chip interactive-fgt-chip ${isFortiGateInteractiveMode ? 'active' : ''}`}
                title={isFortiGateInteractiveMode ? "Chế độ Tạo Lệnh FortiGate (AI ưu tiên tạo lệnh, có thể gọi tool)" : "Chế độ Chat FortiGate (AI ưu tiên trả lời, có thể gọi tool)"}
              >
                {isFortiGateInteractiveMode ? <FiTool size="0.9em" style={{ marginRight: '6px' }} /> : <FiMessageSquare size="0.9em" style={{ marginRight: '6px' }} />}
                {isFortiGateInteractiveMode ? 'Tạo Lệnh (ON)' : 'Chat (ON)'}
              </button>
          )}
        </div>
        <div className="main-input-wrapper">
          <textarea
            ref={textareaRef}
            placeholder={getPlaceholderText()}
            rows={1}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            onClick={onPrimarySubmit}
            disabled={isLoading || !prompt.trim()}
            className="send-button icon-button"
            title={
                targetOs === 'fortios'
                ? (isFortiGateInteractiveMode ? "Tạo lệnh FortiGate (Ctrl+Enter)" : "Chat với FortiAI (Ctrl+Enter)")
                : "Gửi yêu cầu (Ctrl+Enter)"
            }
            aria-label={
                targetOs === 'fortios'
                ? (isFortiGateInteractiveMode ? "Tạo lệnh FortiGate" : "Chat với FortiAI")
                : "Gửi yêu cầu"
            }
          >
            <FiSend />
          </button>
        </div>
      </div>
      <div className="input-footer-text">
        Đây là phiên bản thử nghiệm, AI có thể "suy nghĩ" (gọi tool) để trả lời tốt hơn.
      </div>
    </div>
  );
};

export default UserInput;