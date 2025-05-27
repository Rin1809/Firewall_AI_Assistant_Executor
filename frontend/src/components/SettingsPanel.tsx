// frontend/src/components/SettingsPanel.tsx
import React, { ChangeEvent, CSSProperties } from 'react';
import { FiSave, FiSettings, FiKey, FiAlertTriangle, FiGlobe, FiFileText, FiSliders, FiShield, FiLink, FiList, FiCheckSquare, FiSquare } from 'react-icons/fi';
import { TargetOS, ModelConfig, FortiGateConfig } from '../App';
import './SettingsPanel.css';

interface SettingsPanelProps {
  modelConfig: ModelConfig;
  onConfigChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onSaveSettings: () => void;
  isDisabled: boolean;
  runAsAdmin: boolean;
  uiApiKey: string;
  useUiApiKey: boolean;
  onApplyUiApiKey: () => void;
  onUseEnvKey: () => void;
  targetOs: TargetOS;
  fileType: string;
  customFileName: string;
  fortiGateConfig: FortiGateConfig;
  // Prop moi cho cmd FGT context
  fortiGateContextCommandsConfig: {
    list: string[]; // DS tat ca cmd co the chon
    selected: Record<string, boolean>; // Map cmd -> daChon
  };
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  modelConfig, onConfigChange, onSaveSettings, isDisabled,
  runAsAdmin, uiApiKey, useUiApiKey, onApplyUiApiKey, onUseEnvKey,
  targetOs, fileType, customFileName,
  fortiGateConfig,
  fortiGateContextCommandsConfig,
}) => {

  const getSuggestedFileTypes = (os: TargetOS): { value: string; label: string }[] => {
    switch (os) {
      case 'windows': return [{ value: 'bat', label: '.bat' }, { value: 'ps1', label: '.ps1' }, { value: 'py', label: '.py' }, { value: 'other', label: 'Khác...' }];
      case 'linux': return [{ value: 'sh', label: '.sh' }, { value: 'py', label: '.py' }, { value: 'other', label: 'Khác...' }];
      case 'macos': return [{ value: 'sh', label: '.sh' }, { value: 'py', label: '.py' }, { value: 'other', label: 'Khác...' }];
      case 'fortios': return [{ value: 'fortios', label: '.fortios (CLI)' }, { value: 'txt', label: '.txt (CLI)' }, { value: 'py', label: '.py (Script FGT)' }, { value: 'other', label: 'Khác...' }];
      case 'auto':
      default: return [{ value: 'py', label: '.py' }, { value: 'sh', label: '.sh' }, { value: 'bat', label: '.bat' }, { value: 'ps1', label: '.ps1' }, { value: 'fortios', label: '.fortios (CLI)'}, { value: 'other', label: 'Khác...' }];
    }
  };

  const suggestedTypes = getSuggestedFileTypes(targetOs);
  const isCustomFile = fileType === 'other';
  const getSectionStyle = (index: number): CSSProperties => ({ '--section-index': index } as CSSProperties);

  // Ktra trang thai cua nut "Select All"
  // Dam bao list luon la array
  if (!fortiGateContextCommandsConfig || !Array.isArray(fortiGateContextCommandsConfig.list)) {
    // Neu config hoac list ko khoi tao dung
    // Co the return UI loading/default
    console.warn("Cfg cmd context FGT chua khoi tao dung.");
  }
  const allContextCommandsSelected = fortiGateContextCommandsConfig.list.every(cmd => fortiGateContextCommandsConfig.selected[cmd]);
  const someContextCommandsSelected = fortiGateContextCommandsConfig.list.some(cmd => fortiGateContextCommandsConfig.selected[cmd]);

  // Dinh nghia index cho animation delay theo thu tu DOM
  const modelSectionIndex = 0;
  const apiKeySectionIndex = 1;
  const paramsSectionIndex = 2;
  const targetEnvSectionIndex = 3;
  const fortigateConnectionSectionIndex = 4;
  const fortigateContextCommandsSectionIndex = 5;
  const advancedSettingsSectionIndex = 6;

  return (
    <div className="settings-panel">
      <div className="settings-content">

        {/* Cau hinh Model */}
        <div className="settings-section" style={getSectionStyle(modelSectionIndex)}>
          <label htmlFor="modelName">Model</label>
          <div className="model-select-group">
            <input type="text" id="modelName" name="modelName" value={modelConfig.modelName} onChange={onConfigChange} disabled={isDisabled} placeholder="VD: gemini-1.5-flash" className="model-input"/>
            <button onClick={onSaveSettings} disabled={isDisabled} className="save-button icon-button" title="Lưu Model" aria-label="Lưu cài đặt"><FiSave /></button>
          </div>
        </div>

        {/* API Key */}
        <div className="settings-section api-key-section" style={getSectionStyle(apiKeySectionIndex)}>
            <label htmlFor="uiApiKey"><FiKey /> API Key (Tùy chọn)</label>
            <input type="password" id="uiApiKey" name="uiApiKey" value={uiApiKey} onChange={onConfigChange} disabled={isDisabled} placeholder="Nhập API Key thay cho .env" className="api-key-input" autoComplete="new-password"/>
            <div className="api-key-actions">
                 <button onClick={onApplyUiApiKey} disabled={isDisabled || !uiApiKey.trim()} className="api-action-button apply-key">Dùng Key Này</button>
                 <button onClick={onUseEnvKey} disabled={isDisabled || !useUiApiKey} className="api-action-button use-env-key">Dùng Key .env</button>
            </div>
            {useUiApiKey ? (<span className="api-key-status">Đang dùng API Key từ ô nhập</span>) : (<span className="api-key-status faded">Đang dùng API Key từ .env (nếu set)</span>)}
            <p className="api-key-note">Key chỉ gửi tới backend cục bộ. Không lưu trữ.</p>
        </div>

        {/* Tham so Sinh ma */}
        <div className="settings-section parameter-section" style={getSectionStyle(paramsSectionIndex)}>
          <label><FiSliders /> Tham số Sinh mã</label>
          <div className="settings-subsection">
              <label htmlFor="temperature">Temperature</label>
              <div className="slider-container">
                <input type="range" id="temperature" name="temperature" min="0" max="1" step="0.01" value={modelConfig.temperature} onChange={onConfigChange} disabled={isDisabled} />
                <span className="slider-value">{modelConfig.temperature.toFixed(2)}</span>
              </div>
          </div>
          <div className="settings-subsection">
              <label htmlFor="topP">Top P</label>
              <div className="slider-container">
                <input type="range" id="topP" name="topP" min="0" max="1" step="0.01" value={modelConfig.topP} onChange={onConfigChange} disabled={isDisabled} />
                <span className="slider-value">{modelConfig.topP.toFixed(2)}</span>
              </div>
          </div>
          <div className="settings-subsection">
              <label htmlFor="topK">Top K</label>
              <input type="number" id="topK" name="topK" min="1" step="1" value={modelConfig.topK} onChange={onConfigChange} disabled={isDisabled} className="topk-input" />
          </div>
        </div>

         {/* Moi truong Muc tieu */}
         <div className="settings-section target-environment-section" style={getSectionStyle(targetEnvSectionIndex)}>
           <h4><FiGlobe /> Môi trường Mục tiêu (Script/Lệnh)</h4>
           <label htmlFor="targetOs">Hệ điều hành / Thiết bị</label>
           <select id="targetOs" name="targetOs" value={targetOs} onChange={onConfigChange} disabled={isDisabled}>
              <option value="auto">Tự động (Script)</option>
              <option value="windows">Windows (Script)</option>
              <option value="linux">Linux (Script)</option>
              <option value="macos">macOS (Script)</option>
              <option value="fortios">FortiGate/FortiOS (CLI)</option>
           </select>
           <label htmlFor="fileType"><FiFileText /> Loại File / Lệnh</label>
           <select id="fileType" name="fileType" value={fileType} onChange={onConfigChange} disabled={isDisabled}>
             {suggestedTypes.map(type => (<option key={type.value} value={type.value}>{type.label}</option>))}
           </select>
            <div className={`custom-file-input-container ${isCustomFile ? 'expanded' : ''}`}>
                <label htmlFor="customFileName">Tên File Tùy chỉnh</label>
                <input type="text" id="customFileName" name="customFileName" value={customFileName} onChange={onConfigChange} disabled={isDisabled || !isCustomFile} placeholder="VD: script.js, data.json" className="custom-file-input" aria-hidden={!isCustomFile} tabIndex={isCustomFile ? 0 : -1}/>
                 <p className="custom-file-note">Nhập tên file hoặc chỉ ext (VD: `.txt`).</p>
             </div>
            <p className="target-env-note">Áp dụng cho việc tạo và thực thi file script / lệnh CLI.</p>
         </div>

        {/* Wrapper cho FortiGate Connection Settings */}
        <div className={`fortigate-animation-wrapper ${targetOs === 'fortios' ? 'expanded' : ''}`} style={getSectionStyle(fortigateConnectionSectionIndex)}>
            <div className="settings-section fortigate-connection-section">
                <label><FiLink /> Kết nối FortiGate</label>
                <div className="settings-subsection">
                    <label htmlFor="fortiGateIpHost">IP/Hostname</label>
                    <input type="text" id="fortiGateIpHost" name="ipHost" value={fortiGateConfig.ipHost} onChange={onConfigChange} placeholder="VD: 192.168.1.99" disabled={isDisabled} />
                </div>
                <div className="settings-subsection">
                    <label htmlFor="fortiGatePortSsh">Port SSH</label>
                    <input type="text" id="fortiGatePortSsh" name="portSsh" value={fortiGateConfig.portSsh} onChange={onConfigChange} placeholder="22" disabled={isDisabled} />
                </div>
                <div className="settings-subsection">
                    <label htmlFor="fortiGateUsername">Username</label>
                    <input type="text" id="fortiGateUsername" name="username" value={fortiGateConfig.username} onChange={onConfigChange} placeholder="admin" disabled={isDisabled} />
                </div>
                <div className="settings-subsection">
                    <label htmlFor="fortiGatePassword">Password</label>
                    <input type="password" id="fortiGatePassword" name="password" value={fortiGateConfig.password || ''} onChange={onConfigChange} placeholder="Nhập mật khẩu" disabled={isDisabled} autoComplete="new-password" />
                </div>
                <p className="target-env-note">Dùng để thực thi lệnh CLI và lấy ngữ cảnh.</p>
            </div>
        </div>

        {/* Wrapper for FortiGate Context Commands Settings */}
        <div className={`fortigate-animation-wrapper ${targetOs === 'fortios' ? 'expanded' : ''}`} style={getSectionStyle(fortigateContextCommandsSectionIndex)}>
            <div className="settings-section fortigate-context-commands-section">
                <label><FiList /> Lệnh lấy Ngữ cảnh FortiGate</label>
                <div className="admin-checkbox-container select-all-fgt-ctx">
                     <input
                        type="checkbox"
                        id="fgtCtxCmd_selectAll_id"
                        name="fgtCtxCmd_selectAll"
                        checked={allContextCommandsSelected}
                        ref={input => {
                            if (input) input.indeterminate = someContextCommandsSelected && !allContextCommandsSelected;
                        }}
                        onChange={onConfigChange}
                        disabled={isDisabled}
                        className="admin-checkbox"
                    />
                    <label htmlFor="fgtCtxCmd_selectAll_id" className="admin-checkbox-label" style={{ fontWeight: 600 }}>
                        {allContextCommandsSelected ? <FiCheckSquare style={{color: 'var(--accent-primary)'}}/> : <FiSquare />}
                        Chọn Tất cả / Bỏ chọn Tất cả
                    </label>
                </div>
                <div className="command-checkbox-list">
                    {fortiGateContextCommandsConfig.list.map((cmd, index) => (
                        <div key={cmd + index} className="command-checkbox-item admin-checkbox-container">
                            <input type="checkbox" id={`fgtCtxCmd_id_${cmd.replace(/\s+/g, '-')}-${index}`} name={`fgtCtxCmd_${cmd}`} checked={!!fortiGateContextCommandsConfig.selected[cmd]} onChange={onConfigChange} disabled={isDisabled} className="admin-checkbox"/>
                            <label htmlFor={`fgtCtxCmd_id_${cmd.replace(/\s+/g, '-')}-${index}`} className="admin-checkbox-label command-label">
                                {fortiGateContextCommandsConfig.selected[cmd] ? <FiCheckSquare style={{color: 'var(--accent-primary)', fontSize: '0.9em'}}/> : <FiSquare style={{fontSize: '0.9em'}} />}
                                <code>{cmd}</code>
                            </label>
                        </div>
                    ))}
                </div>
                 <p className="target-env-note">Các lệnh này sẽ được chạy để lấy thông tin ngữ cảnh khi bạn tương tác với AI về FortiGate.</p>
            </div>
        </div>

        {/* Cai dat Khac */}
        <div className="settings-section advanced-settings-section" style={getSectionStyle(advancedSettingsSectionIndex)}>
           <h4><FiSettings/> Cài đặt Khác</h4>
           <label htmlFor="safetySetting"><FiShield /> Lọc Nội dung An toàn</label>
           <select id="safetySetting" name="safetySetting" value={modelConfig.safetySetting} onChange={onConfigChange} disabled={isDisabled} >
             <option value="BLOCK_NONE">Không chặn</option> <option value="BLOCK_ONLY_HIGH">Chặn mức Cao</option>
             <option value="BLOCK_MEDIUM_AND_ABOVE">Chặn mức Trung bình+ (Mặc định)</option> <option value="BLOCK_LOW_AND_ABOVE">Chặn mức Thấp+</option>
           </select>
           <div className="admin-checkbox-container">
               <input type="checkbox" id="runAsAdmin" name="runAsAdmin" checked={runAsAdmin} onChange={onConfigChange} disabled={isDisabled || targetOs === 'fortios'} className="admin-checkbox"/>
              <label htmlFor="runAsAdmin" className="admin-checkbox-label"> <FiAlertTriangle className="warning-icon" /> Chạy với quyền Admin/Root (Script) </label>
           </div>
           <p className="admin-warning-note">Cẩn trọng! Chỉ bật nếu hiểu rõ mã script. Backend cũng cần quyền tương ứng. Không áp dụng cho FortiOS.</p>
        </div>
      </div>
    </div>
  );
};
export default SettingsPanel;