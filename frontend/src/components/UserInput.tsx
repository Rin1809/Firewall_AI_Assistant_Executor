// frontend/src/components/UserInput.tsx
import React, { KeyboardEvent, useRef, useEffect } from 'react';
import { FiSend, FiTool } from 'react-icons/fi'; // FiTool cho nut Tuong Tac
import { TargetOS } from '../App';
import './UserInput.css';

interface UserInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onPrimarySubmit: () => void; // Ham xu ly chinh khi gui (Ctrl+Enter hoac nut Send)
  isLoading: boolean;
  targetOs: TargetOS;
  isFortiGateInteractiveMode: boolean; // Trang thai che do tuong tac FGT
  onToggleFortiGateInteractiveMode: () => void; // Ham de bat/tat che do
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
            ? "Nhập yêu cầu tạo lệnh/cấu hình FortiGate (Ctrl+Enter để gửi)..."
            : "Chat với FortiAI về FortiGate (Ctrl+Enter để gửi)...";
      }
      return "Nhập yêu cầu (Ctrl+Enter để gửi)...";
  };

  return (
    <div className="user-input-container">
      <div className="user-input-area">
        {/* Container for suggestion chips, luon render de animation */}
        <div className={`input-suggestion-chips ${targetOs === 'fortios' ? 'visible' : ''}`}>
          {/* Nut chi render khi targetOs la 'fortios' */}
          {targetOs === 'fortios' && (
              <button
                onClick={onToggleFortiGateInteractiveMode}
                disabled={isLoading}
                className={`suggestion-chip interactive-fgt-chip ${isFortiGateInteractiveMode ? 'active' : ''}`}
                title={isFortiGateInteractiveMode ? "Tắt chế độ tạo lệnh FortiGate (Chuyển sang Chat)" : "Bật chế độ tạo lệnh FortiGate"}
              >
                <FiTool size="0.9em" style={{ marginRight: '6px' }} />
                Tương tác {isFortiGateInteractiveMode ? '(ON)' : '(OFF)'}
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
        Đây là phiên bản thử nghiệm, có thể gặp lỗi trong quá trình sử dụng. ᓚᘏᗢ
      </div>
    </div>
  );
};

export default UserInput;