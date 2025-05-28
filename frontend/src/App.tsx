// Firewall AI Assistant  - Executor\frontend\src\App.tsx
import React, { useState, ChangeEvent, useEffect, useCallback } from 'react';
import CenterArea from './components/CenterArea';
import Sidebar from './components/Sidebar';
// AiThinkingDisplay is imported within components that use it
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
// Icons are imported within components that use them

// --- Dinh nghia kieu du lieu (Interfaces) ---
export interface ExecutionResult {
  message: string;
  output: string;
  error: string;
  return_code: number;
  codeThatFailed?: string;
  warning?: string;
  executed_file_type?: string;
}

export interface ReviewResult {
    review?: string;
    error?: string;
}

export interface ModelConfig {
    modelName: string;
    temperature: number;
    topP: number;
    topK: number;
    safetySetting: string;
    api_key?: string;
}

export interface DebugResult {
    explanation: string | null;
    corrected_code: string | null;
    suggested_package?: string;
    error?: string;
    original_language?: string;
}

export interface ExplainResult {
    explanation?: string;
    error?: string;
}

export interface InstallationResult {
    success: boolean;
    message: string;
    output: string;
    error: string;
    package_name: string;
}

export type TargetOS = 'auto' | 'windows' | 'linux' | 'macos' | 'fortios';

export interface FortiGateConfig {
  ipHost: string;
  portSsh: string;
  username: string;
  password?: string;
}

export interface AiThought {
    type: 'function_call_request' | 'function_call_result';
    tool_name: string;
    tool_args?: Record<string, any>;
    result_data?: any;
    is_error?: boolean;
    timestamp: string;
}

export interface ConversationBlock {
    type: 'user' | 'ai-code' | 'review' | 'execution' | 'debug' | 'loading' | 'error' | 'installation' | 'explanation' | 'placeholder' | 'ai_thinking_process';
    data: any;
    id: string;
    timestamp: string;
    isNew?: boolean;
    generatedType?: string;
    thoughts?: AiThought[];
    parentConversation?: ConversationBlock[];
}
// ---------------------------------------------

// --- CONSTANTS ---
const MODEL_NAME_STORAGE_KEY = 'geminiExecutorModelName';
const FORTIGATE_CONFIG_STORAGE_KEY = 'geminiExecutorFortiGateConfig';
const TARGET_OS_STORAGE_KEY = 'geminiExecutorTargetOS';
const FILE_TYPE_STORAGE_KEY = 'geminiExecutorFileType';
const CUSTOM_FILE_NAME_STORAGE_KEY = 'geminiExecutorCustomFileName';
const FGT_INTERACTIVE_MODE_STORAGE_KEY = 'geminiExecutorFgtInteractiveMode';
const FGT_CONTEXT_COMMANDS_STORAGE_KEY = 'geminiExecutorFgtContextCommands';
const LOG_VIEWER_VISIBLE_KEY = 'geminiExecutorLogViewerVisible';


const NEW_BLOCK_ANIMATION_DURATION = 500;

const DEFAULT_FORTIGATE_CONTEXT_COMMANDS = [
    "get system status", "get system performance status", "show system interface",
    "show firewall policy", "show firewall address", "show firewall vip",
    "show firewall ippool", "show firewall service custom", "show firewall service group",
    "get router info routing-table all", "diagnose log display event --view-limit 20",
    "get system dns", "get system dhcp server", "diagnose sys session list",
    "get system admin list", "show vpn ssl settings", "get vpn ipsec tunnel summary",
    "show user local", "show user group", "get system ha status",
    "diagnose hardware deviceinfo nic", "get webfilter profile",
    "get application list", "show log setting", "show firewall policy"
];

interface ApiResponseWithThoughts {
    code?: string;
    explanation?: string;
    chat_response?: string;
    generated_for_type?: string;
    error?: string;
    thoughts?: AiThought[];
    review?: string;
}


function App() {
  const [prompt, setPrompt] = useState<string>('');
  const [conversation, setConversation] = useState<Array<ConversationBlock>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [isDebugging, setIsDebugging] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [isExplaining, setIsExplaining] = useState<boolean>(false);

  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    modelName: localStorage.getItem(MODEL_NAME_STORAGE_KEY) || 'gemini-1.5-flash',
    temperature: 0.7, topP: 0.95, topK: 40, safetySetting: 'BLOCK_MEDIUM_AND_ABOVE',
  });

  const [fortiGateConfig, setFortiGateConfig] = useState<FortiGateConfig>(() => {
    const saved = localStorage.getItem(FORTIGATE_CONFIG_STORAGE_KEY);
    return saved ? JSON.parse(saved) : { ipHost: '', portSsh: '22', username: 'admin', password: '' };
  });

  const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>({});
  const [expandedOutputs, setExpandedOutputs] = useState<Record<string, { stdout: boolean; stderr: boolean }>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [runAsAdmin, setRunAsAdmin] = useState<boolean>(false);
  const [uiApiKey, setUiApiKey] = useState<string>('');
  const [useUiApiKey, setUseUiApiKey] = useState<boolean>(false);

  const [targetOs, setTargetOs] = useState<TargetOS>(() => (localStorage.getItem(TARGET_OS_STORAGE_KEY) as TargetOS) || 'auto');
  const [fileType, setFileType] = useState<string>(localStorage.getItem(FILE_TYPE_STORAGE_KEY) || 'py');
  const [customFileName, setCustomFileName] = useState<string>(localStorage.getItem(CUSTOM_FILE_NAME_STORAGE_KEY) || '');
  const [isFortiGateInteractiveMode, setIsFortiGateInteractiveMode] = useState<boolean>(() => {
      const savedMode = localStorage.getItem(FGT_INTERACTIVE_MODE_STORAGE_KEY);
      return savedMode === 'true';
  });

  const [fortiGateContextCommands, setFortiGateContextCommands] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(FGT_CONTEXT_COMMANDS_STORAGE_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) { console.error("Loi phan tich cmd FGT context da luu", e); }
    }
    const initial: Record<string, boolean> = {};
    DEFAULT_FORTIGATE_CONTEXT_COMMANDS.forEach(cmd => initial[cmd] = true);
    return initial;
  });

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [currentEditingCode, setCurrentEditingCode] = useState<string | null>(null);
  
  const [backendLogs, setBackendLogs] = useState<string[]>(["Đang chờ log từ backend..."]);
  const [isLogViewerVisible, setIsLogViewerVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem(LOG_VIEWER_VISIBLE_KEY);
    return saved ? JSON.parse(saved) : false; // Default to false
  });

  const toggleLogViewer = useCallback(() => {
    setIsLogViewerVisible(prev => {
        const newState = !prev;
        localStorage.setItem(LOG_VIEWER_VISIBLE_KEY, JSON.stringify(newState));
        return newState;
    });
  }, []);

  const fetchBackendLogs = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5001/api/backend_logs?lines=75'); 
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({error: "Lỗi không xác định khi fetch logs"}));
        const errorMsg = `Lỗi fetch logs: ${errorData.error || response.statusText || response.status}`;
        setBackendLogs(prevLogs => {
            if (prevLogs.length > 0 && prevLogs[prevLogs.length -1].startsWith("Lỗi fetch logs:")) return prevLogs;
            return [...prevLogs.slice(-100), errorMsg];
        });
        return;
      }
      const data = await response.json();
      if (data.logs && Array.isArray(data.logs)) {
        setBackendLogs(data.logs);
      }
    } catch (error: any) {
      console.error("Failed to fetch backend logs:", error);
      const errorMsg = `Lỗi mạng khi fetch logs: ${error.message || String(error)}`;
      setBackendLogs(prevLogs => {
        if (prevLogs.length > 0 && prevLogs[prevLogs.length -1].startsWith("Lỗi mạng khi fetch logs:")) return prevLogs;
        return [...prevLogs.slice(-100), errorMsg];
      });
    }
  }, []);

  useEffect(() => {
    fetchBackendLogs(); 
    const intervalId = setInterval(fetchBackendLogs, 7000); 
    return () => clearInterval(intervalId);
  }, [fetchBackendLogs]);


   useEffect(() => {
        const newBlockIds = conversation.filter(b => b.isNew).map(b => b.id);
        if (newBlockIds.length > 0) {
            const timer = setTimeout(() => {
                setConversation(prevConv =>
                    prevConv.map(b => (newBlockIds.includes(b.id) ? { ...b, isNew: false } : b))
                );
            }, NEW_BLOCK_ANIMATION_DURATION + 150);
            return () => clearTimeout(timer);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(conversation.filter(b => b.isNew).map(b => b.id))]);


    const toggleFortiGateInteractiveMode = useCallback(() => {
        setIsFortiGateInteractiveMode(prevMode => {
            const newMode = !prevMode;
            localStorage.setItem(FGT_INTERACTIVE_MODE_STORAGE_KEY, String(newMode));
            return newMode;
        });
    }, []);

    useEffect(() => {
        if (targetOs !== 'fortios' && isFortiGateInteractiveMode) {
            setIsFortiGateInteractiveMode(false);
            localStorage.setItem(FGT_INTERACTIVE_MODE_STORAGE_KEY, 'false');
        }
    }, [targetOs, isFortiGateInteractiveMode]);


  const handleConfigChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    if (name.startsWith('fgtCtxCmd_')) {
        const cmd = name.substring('fgtCtxCmd_'.length);
        if (cmd === 'selectAll') {
            const newStates: Record<string, boolean> = {};
            DEFAULT_FORTIGATE_CONTEXT_COMMANDS.forEach(c => newStates[c] = checked);
            setFortiGateContextCommands(newStates);
        } else {
            setFortiGateContextCommands(prev => ({ ...prev, [cmd]: checked }));
        }
        return;
    }

    if (name === 'targetOs') {
      const newTargetOs = value as TargetOS;
      setTargetOs(newTargetOs);
      localStorage.setItem(TARGET_OS_STORAGE_KEY, newTargetOs);
      if (newTargetOs === 'fortios') {
          if (fileType !== 'fortios' && fileType !== 'txt') {
             setFileType('fortios');
             localStorage.setItem(FILE_TYPE_STORAGE_KEY, 'fortios');
          }
      } else if (fileType === 'fortios') {
          const defaultFileType = newTargetOs === 'windows' ? 'bat' : (newTargetOs === 'auto' ? 'py' : 'sh');
          setFileType(defaultFileType);
          localStorage.setItem(FILE_TYPE_STORAGE_KEY, defaultFileType);
      }
    } else if (name === 'fileType') {
      setFileType(value);
      localStorage.setItem(FILE_TYPE_STORAGE_KEY, value);
      if (value === 'fortios' && targetOs !== 'fortios') {
          setTargetOs('fortios');
          localStorage.setItem(TARGET_OS_STORAGE_KEY, 'fortios');
      }
      if (value !== 'other') {
          setCustomFileName('');
          localStorage.setItem(CUSTOM_FILE_NAME_STORAGE_KEY, '');
      }
    } else if (name === 'customFileName') {
      setCustomFileName(value);
      localStorage.setItem(CUSTOM_FILE_NAME_STORAGE_KEY, value);
    } else if (['modelName', 'temperature', 'topP', 'topK', 'safetySetting'].includes(name)) {
        setModelConfig(prev => ({ ...prev, [name]: (type === 'number' || name === 'temperature' || name === 'topP' || name === 'topK') ? parseFloat(value) : value }));
    } else if (name === 'runAsAdmin' && type === 'checkbox') {
        setRunAsAdmin(checked);
    } else if (name === 'uiApiKey' && (type === 'password' || type === 'text')) {
        setUiApiKey(value);
    } else if (['ipHost', 'portSsh', 'username', 'password'].includes(name) && Object.keys(fortiGateConfig).includes(name as keyof FortiGateConfig)) {
        setFortiGateConfig(prev => {
            const newFgtCfg = { ...prev, [name]: value };
            localStorage.setItem(FORTIGATE_CONFIG_STORAGE_KEY, JSON.stringify(newFgtCfg));
            return newFgtCfg;
        });
    }
  }, [fileType, targetOs, fortiGateConfig]);

  const handleSaveSettings = useCallback(() => {
    localStorage.setItem(MODEL_NAME_STORAGE_KEY, modelConfig.modelName);
    toast.success(`Đã lưu model: ${modelConfig.modelName}. Các cài đặt khác tự lưu khi thay đổi.`);
  }, [modelConfig.modelName]);

  const handleApplyUiApiKey = useCallback(() => { uiApiKey.trim() ? (setUseUiApiKey(true), toast.info("Dùng API Key từ Cài đặt.")) : toast.warn("Nhập API Key trước."); }, [uiApiKey]);
  const handleUseEnvKey = useCallback(() => { setUseUiApiKey(false); toast.info("Dùng API Key từ .env (nếu có)."); }, []);
  const handleToggleSidebar = useCallback(() => { setIsSidebarOpen(prev => !prev); }, []);
  const toggleCollapse = useCallback((blockId: string) => setCollapsedStates(prev => ({ ...prev, [blockId]: !prev[blockId] })), []);
  const onToggleOutputExpand = useCallback((blockId: string, type: 'stdout' | 'stderr') => setExpandedOutputs(prev => ({ ...prev, [blockId]: { ...(prev[blockId] || { stdout: false, stderr: false }), [type]: !(prev[blockId]?.[type] ?? false) }})), []);

  const handleToggleEditCode = useCallback((blockIdToEdit: string, codeInBlockData: string) => {
    if (editingBlockId === blockIdToEdit) {
        setEditingBlockId(null);
        setCurrentEditingCode(null);
        toast.info("Đã hủy chỉnh sửa.");
    } else {
        if (editingBlockId && currentEditingCode !== null) {
            const oldBlock = conversation.find(b => b.id === editingBlockId);
            if (oldBlock && oldBlock.data !== currentEditingCode) {
                 toast.warn(`Thay đổi trên block trước chưa được lưu và đã bị hủy.`);
            }
        }
        setEditingBlockId(blockIdToEdit);
        setCurrentEditingCode(codeInBlockData);
    }
  }, [editingBlockId, currentEditingCode, conversation]);

  const handleUpdateEditingCode = useCallback((newCode: string) => {
    setCurrentEditingCode(newCode);
  }, []);

  const handleSaveEditedCode = useCallback((blockIdToSave: string) => {
    if (currentEditingCode === null) return;
    setConversation(prevConv =>
        prevConv.map(b =>
            b.id === blockIdToSave ? { ...b, data: currentEditingCode, isNew: true } : b
        )
    );
    setEditingBlockId(null);
    setCurrentEditingCode(null);
    toast.success("Đã lưu mã đã chỉnh sửa!");
  }, [currentEditingCode]);

  const handleCancelEditCode = useCallback(() => {
    if (editingBlockId && currentEditingCode !== null) {
        const oldBlock = conversation.find(b => b.id === editingBlockId);
        if (oldBlock && oldBlock.data !== currentEditingCode) {
             toast.info("Đã hủy các thay đổi chưa lưu.");
        } else {
            toast.info("Đã hủy chỉnh sửa.");
        }
    }
    setEditingBlockId(null);
    setCurrentEditingCode(null);
  }, [editingBlockId, currentEditingCode, conversation]);


  const sendApiRequest = useCallback(async (endpoint: string, body: any, isFortiGateExecutionForExecuteEndpoint: boolean = false): Promise<ApiResponseWithThoughts> => {
    const controller = new AbortController();
    const timeout = (endpoint === 'execute' && isFortiGateExecutionForExecuteEndpoint) ? 120000 : 90000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let effectiveModelConfig = { ...modelConfig };
    const needsApiKey = ['generate', 'review', 'debug', 'explain', 'fortigate_chat'].includes(endpoint);
    if (useUiApiKey && uiApiKey && needsApiKey) {
      effectiveModelConfig = { ...effectiveModelConfig, api_key: uiApiKey };
    } else {
      delete effectiveModelConfig.api_key;
    }

    let finalBody: any = { ...body, model_config: effectiveModelConfig };

    const isFgtRelatedForContextOrChat = (
        (endpoint === 'generate' && (body.target_os === 'fortios' || body.file_type === 'fortios' || (body.prompt && (body.prompt.toLowerCase().includes('fortigate') || body.prompt.toLowerCase().includes('fortios'))))) ||
        (endpoint === 'debug' && body.file_type === 'fortios') ||
        (endpoint === 'fortigate_chat')
    );

    if (isFgtRelatedForContextOrChat) {
        const selectedCommands = Object.entries(fortiGateContextCommands)
                                     .filter(([, isSelected]) => isSelected)
                                     .map(([cmd]) => cmd);
        finalBody.fortigate_selected_context_commands = selectedCommands.length > 0 ? selectedCommands : DEFAULT_FORTIGATE_CONTEXT_COMMANDS;

        if (endpoint === 'debug') finalBody.fortigate_config_for_context = fortiGateConfig;
        else finalBody.fortigate_config = fortiGateConfig;
    }

    if (endpoint === 'execute' && isFortiGateExecutionForExecuteEndpoint) {
        if (!fortiGateConfig.ipHost || !fortiGateConfig.username) {
            toast.error("Vui lòng nhập đủ thông tin kết nối FortiGate trong Cài đặt (IP/Host & Username).");
            setIsSidebarOpen(true);
            clearTimeout(timeoutId);
            throw new Error("Thiếu cấu hình FortiGate");
        }
        finalBody = { ...finalBody, fortigate_config: fortiGateConfig };
    }


    try {
        const response = await fetch(`http://localhost:5001/api/${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalBody), signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data: ApiResponseWithThoughts = await response.json();
        if (!response.ok) {
            let errorMsg = data?.error || `Lỗi ${response.status} từ /api/${endpoint}`;
            const errorToThrow: any = new Error(errorMsg);
            if (data?.thoughts) errorToThrow.thoughts = data.thoughts;
            throw errorToThrow;
        }
        return data;
    } catch (error: any) {
         clearTimeout(timeoutId);
         if (error.name === 'AbortError') {
             const abortError: any = new Error(`Yêu cầu đến /api/${endpoint} quá thời gian.`);
             if (error.thoughts) abortError.thoughts = error.thoughts;
             throw abortError;
         }
         if (!error.thoughts && finalBody.thoughts) error.thoughts = finalBody.thoughts;
         throw error;
    }
  }, [modelConfig, useUiApiKey, uiApiKey, fortiGateConfig, fortiGateContextCommands]);

  const addThoughtsAndResultToConversation = useCallback((
    loadingId: string,
    apiResponse: ApiResponseWithThoughts,
    resultBlockType: ConversationBlock['type'],
    resultDataExtractor: (data: ApiResponseWithThoughts) => any,
    extraResultProps?: Partial<ConversationBlock>
  ) => {
    setConversation(prevConv => {
        let newBlocksToAdd: ConversationBlock[] = [];
        const now = new Date().toISOString();

        if (apiResponse.thoughts && apiResponse.thoughts.length > 0) {
            newBlocksToAdd.push({
                type: 'ai_thinking_process', data: null, id: loadingId + '_think',
                timestamp: now, isNew: true, thoughts: apiResponse.thoughts,
                parentConversation: prevConv // Pass current conversation for context
            });
        }

        let mainResultData = resultDataExtractor(apiResponse);
        if (mainResultData === undefined) {
            if (resultBlockType === 'ai-code') mainResultData = ''; 
            else if (resultBlockType === 'explanation' || resultBlockType === 'review') mainResultData = { [resultBlockType]: '(Không có nội dung)'};
            else mainResultData = null;
        }

        newBlocksToAdd.push({
            type: resultBlockType, data: mainResultData, id: loadingId + '_res',
            timestamp: now, isNew: true, generatedType: apiResponse.generated_for_type,
            parentConversation: prevConv, // Pass current conversation for context
            ...(extraResultProps || {})
        });

        const finalConversation = prevConv.filter(b => b.id !== loadingId);
        // Update parentConversation for all blocks in the new array
        const updatedFinalConversation = [...finalConversation, ...newBlocksToAdd];
        return updatedFinalConversation.map(b => ({...b, parentConversation: updatedFinalConversation}));
    });
  }, []);


  const handleGenerate = useCallback(async (currentPrompt: string) => {
    setIsLoading(true);
    const now = new Date().toISOString();
    const newCollapsedStates: Record<string, boolean> = {};
    conversation.filter(b => b.type === 'user').forEach(block => { newCollapsedStates[block.id] = true; });
    setCollapsedStates(prev => ({ ...prev, ...newCollapsedStates }));

    const userBlockTypeSuffix = targetOs === 'fortios' && isFortiGateInteractiveMode ? '_u_fgt_interactive' : '_u_gen';
    const newUserBlock: ConversationBlock = { type: 'user', data: currentPrompt, id: Date.now().toString() + userBlockTypeSuffix, timestamp: now, isNew: true, parentConversation: conversation };
    const loadingId = Date.now().toString() + '_gload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: targetOs === 'fortios' && isFortiGateInteractiveMode ? 'FortiAI đang tạo lệnh (có thể gọi tool)...' : 'Đang tạo...', id: loadingId, timestamp: now, isNew: true, thoughts: [], parentConversation: [...conversation, newUserBlock] };
    
    const updatedConversationWithUserAndLoading = [...conversation, newUserBlock, loadingBlock];
    setConversation(updatedConversationWithUserAndLoading.map(b => ({ ...b, parentConversation: updatedConversationWithUserAndLoading })));
    setCollapsedStates(prev => ({ ...prev, [newUserBlock.id]: false }));

    const finalFileTypeForRequest = fileType === 'other' ? customFileName.trim() || 'txt' : fileType;
    const bodyForGenerate: any = {
        prompt: currentPrompt,
        target_os: targetOs,
        file_type: finalFileTypeForRequest
    };

    try {
      const data = await sendApiRequest('generate', bodyForGenerate);
      addThoughtsAndResultToConversation(
          loadingId, data, 'ai-code',
          (d) => d.code,
          { generatedType: data.generated_for_type }
      );
      toast.success(data.generated_for_type === 'fortios' ? "Đã tạo lệnh FortiGate!" : "Đã tạo mã!");
      setPrompt('');
    } catch (err: any) {
      const errorMessage = err.message || 'Lỗi tạo mã/lệnh.';
      toast.error(errorMessage);
      if (err.thoughts && err.thoughts.length > 0) {
          addThoughtsAndResultToConversation(
              loadingId,
              { error: errorMessage, thoughts: err.thoughts },
              'error', (d) => d.error
          );
      } else {
          setConversation(prev => {
              const convWithoutLoading = prev.filter(b => b.id !== loadingId);
              const errorBlock = { type: 'error', data: errorMessage, id: loadingId + '_err', timestamp: new Date().toISOString(), isNew: true, thoughts:[], parentConversation: convWithoutLoading };
              const finalConv = [...convWithoutLoading, errorBlock];
              return finalConv.map(b => ({...b, parentConversation: finalConv}));
          });
      }
    } finally { setIsLoading(false); }
  }, [sendApiRequest, conversation, setPrompt, fileType, customFileName, targetOs, isFortiGateInteractiveMode, addThoughtsAndResultToConversation]);

  const handleFortiGateChat = useCallback(async (currentPrompt: string) => {
    setIsLoading(true);
    const now = new Date().toISOString();
    const newCollapsedStates: Record<string, boolean> = {};
    conversation.filter(b => b.type === 'user').forEach(block => { newCollapsedStates[block.id] = true; });
    setCollapsedStates(prev => ({ ...prev, ...newCollapsedStates }));

    const newUserBlock: ConversationBlock = { type: 'user', data: currentPrompt, id: Date.now().toString() + '_u_chat', timestamp: now, isNew: true, parentConversation: conversation };
    const loadingId = Date.now().toString() + '_chatload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: 'FortiAI đang nghĩ (có thể gọi tool)...', id: loadingId, timestamp: now, isNew: true, thoughts: [], parentConversation: [...conversation, newUserBlock] };

    const updatedConversationWithUserAndLoading = [...conversation, newUserBlock, loadingBlock];
    setConversation(updatedConversationWithUserAndLoading.map(b => ({ ...b, parentConversation: updatedConversationWithUserAndLoading })));
    setCollapsedStates(prev => ({ ...prev, [newUserBlock.id]: false }));

    const relevantHistoryTypesForFgtChat: ConversationBlock['type'][] = [
      'user', 'ai-code', 'execution', 'explanation', 'ai_thinking_process'
    ];
    const MAX_HISTORY_BLOCKS_FOR_CHAT = 10;
    const historyForChatContext = conversation // Use the state `conversation` which is up-to-date before this call
      .filter(b => relevantHistoryTypesForFgtChat.includes(b.type))
      .slice(-MAX_HISTORY_BLOCKS_FOR_CHAT)
      .map(block => {
        let content = "";
        const blockTypeLabel = `[${block.type.toUpperCase()}${block.type === 'ai-code' && block.generatedType ? ` (${block.generatedType})` : ''}]`;
        const blockTime = new Date(block.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (block.type === 'user') {
          content = `Người dùng (${blockTime}): ${String(block.data)}`;
        } else if (block.type === 'ai-code' && block.generatedType === 'fortios') {
          content = `AI tạo lệnh FortiOS (${blockTime}):\n\`\`\`fortios\n${String(block.data)}\n\`\`\``;
        } else if (block.type === 'execution' && (block.data as ExecutionResult)?.executed_file_type === 'fortios') {
          const execData = block.data as ExecutionResult;
          content = `Kết quả thực thi lệnh FortiOS trên (${blockTime}):\n`;
          if (execData.output?.trim()) content += `Output:\n${execData.output.trim()}\n`;
          if (execData.error?.trim()) content += `Lỗi:\n${execData.error.trim()}\n`;
          content += `Mã trả về: ${execData.return_code}`;
          if (execData.warning?.trim()) content += `\nCảnh báo: ${execData.warning.trim()}`;
        } else if (block.type === 'explanation') {
          content = `AI trả lời (${blockTime}): ${String((block.data as ExplainResult)?.explanation || block.data)}`;
        } else if (block.type === 'ai_thinking_process' && block.thoughts) {
            content = `AI đã thực hiện các bước sau (${blockTime}):\n` +
                      block.thoughts.map(th =>
                          th.type === 'function_call_request'
                          ? `  - Gọi tool: ${th.tool_name} với args: ${JSON.stringify(th.tool_args)}`
                          : `  - Kết quả tool ${th.tool_name}: ${th.is_error ? 'LỖI' : 'OK'} - ${String(th.result_data).substring(0,100)}...`
                      ).join('\n');
        } else { return null; }
        return `${blockTypeLabel}\n${content.trim()}`;
      })
      .filter(item => item !== null)
      .join('\n\n---\n\n');

    try {
      const data = await sendApiRequest('fortigate_chat', {
        prompt: currentPrompt,
        conversation_history_for_chat_context: historyForChatContext || "(Không có lịch sử FortiOS gần đây)",
      }, false);

      addThoughtsAndResultToConversation(
          loadingId, data, 'explanation',
          (d) => ({ explanation: d.chat_response })
      );
      toast.success("FortiAI đã trả lời!");
      setPrompt('');
    } catch (err: any) {
      const errorMessage = err.message || 'Lỗi khi chat với FortiGate.';
      toast.error(errorMessage);
      if (err.thoughts && err.thoughts.length > 0) {
          addThoughtsAndResultToConversation(
              loadingId,
              { error: errorMessage, thoughts: err.thoughts },
              'error', (d) => d.error
          );
      } else {
         setConversation(prev => {
            const convWithoutLoading = prev.filter(b => b.id !== loadingId);
            const errorBlock = { type: 'error', data: errorMessage, id: loadingId + '_chaterr', timestamp: new Date().toISOString(), isNew: true, thoughts:[], parentConversation: convWithoutLoading };
            const finalConv = [...convWithoutLoading, errorBlock];
            return finalConv.map(b => ({...b, parentConversation: finalConv}));
          });
      }
    } finally { setIsLoading(false); }
  }, [sendApiRequest, conversation, setPrompt, addThoughtsAndResultToConversation]);

  const handleGenerateOrFortiGateChat = useCallback(async (currentPrompt: string) => {
    if (!currentPrompt.trim()) {
        toast.warn('Vui lòng nhập yêu cầu.');
        return;
    }
    // Crucial: Pass the current `conversation` state to the handlers
    if (targetOs === 'fortios') {
        if (isFortiGateInteractiveMode) {
            await handleGenerate(currentPrompt);
        } else {
            await handleFortiGateChat(currentPrompt);
        }
    } else {
        await handleGenerate(currentPrompt);
    }
  }, [targetOs, isFortiGateInteractiveMode, handleGenerate, handleFortiGateChat, conversation]);

  const handleReviewCode = useCallback(async (codeToReviewFromBlock: string | null, blockId: string) => {
    const blockToReview = conversation.find(b => b.id === blockId);
    let codeToReview = codeToReviewFromBlock;
    if (blockToReview?.type === 'ai-code' && editingBlockId === blockId && currentEditingCode !== null) {
        codeToReview = currentEditingCode;
    }
    if (!codeToReview) { toast.warn("Ko có mã/lệnh để review."); return; }

    const fileTypeToSend = blockToReview?.generatedType || 'py';

    setIsReviewing(true);
    const now = new Date().toISOString();
    const loadingId = Date.now().toString() + '_rload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: 'Đang đánh giá...', id: loadingId, timestamp: now, isNew: true, thoughts: [], parentConversation: conversation };
    const originalBlockIndex = conversation.findIndex(b => b.id === blockId);
    
    const newConvWithLoading = [...conversation];
    if (originalBlockIndex !== -1) newConvWithLoading.splice(originalBlockIndex + 1, 0, loadingBlock); 
    else newConvWithLoading.push(loadingBlock);
    setConversation(newConvWithLoading.map(b => ({ ...b, parentConversation: newConvWithLoading })));

    try {
        const data: ReviewResult = await sendApiRequest('review', { code: codeToReview, file_type: fileTypeToSend }) as ReviewResult;
        addThoughtsAndResultToConversation(loadingId, data as ApiResponseWithThoughts, 'review', d => d);
        toast.success("Đã đánh giá xong!");
    } catch (err: any) {
        const errorData: ReviewResult = { error: err.message || 'Lỗi review.' };
        addThoughtsAndResultToConversation(loadingId, { ...errorData, thoughts: err.thoughts } as ApiResponseWithThoughts, 'review', d => d);
        toast.error(err.message || 'Lỗi review.');
    } finally { setIsReviewing(false); }
  }, [sendApiRequest, conversation, editingBlockId, currentEditingCode, addThoughtsAndResultToConversation]);

  const handleExecute = useCallback(async (codeToExecuteFromBlock: string | null, blockId: string) => {
    const blockToExecute = conversation.find(b => b.id === blockId);
    let codeToExecute = codeToExecuteFromBlock;
     if (blockToExecute?.type === 'ai-code' && editingBlockId === blockId && currentEditingCode !== null) {
        codeToExecute = currentEditingCode;
    }
    if (!codeToExecute) { toast.warn("Ko có mã/lệnh để thực thi."); return; }

    const execType = blockToExecute?.generatedType || 'py';

    setIsExecuting(true);
    const isFGTExecution = execType === 'fortios';
    const toastMsg = isFGTExecution ? 'Đang gửi lệnh tới FortiGate...' : `Đang thực thi ${runAsAdmin ? ' với quyền Admin/Root' : ''}...`;
    const toastId = toast.loading(toastMsg);
    const executionBlockId = Date.now().toString() + '_ex';
    const now = new Date().toISOString();
    const originalBlockIndex = conversation.findIndex(b => b.id === blockId);
    
    const newConvForExec = [...conversation]; // Capture current conversation state
    // No loading block added here, result is added directly
    
    const endpoint = 'execute';
    let payload: any = { code: codeToExecute, file_type: execType };
    if (!isFGTExecution) {
        payload.run_as_admin = runAsAdmin;
    }

    let resultData: ExecutionResult | null = null;
    try {
        const data: ExecutionResult = await sendApiRequest(endpoint, payload, isFGTExecution) as ExecutionResult;
        resultData = { ...data, codeThatFailed: codeToExecute, executed_file_type: execType };

        if (data.warning) toast.warning(data.warning, { autoClose: 7000, toastId: `warning-${executionBlockId}` });
        const stdoutErrorKeywords = ['lỗi', 'error', 'fail', 'cannot', 'unable', 'traceback', 'exception', 'not found', 'không tìm thấy', 'invalid', 'command parse error', 'command_cli_error'];
        const stdoutLooksLikeError = data.output?.trim() && stdoutErrorKeywords.some(kw => data.output.toLowerCase().includes(kw));
        const hasError = data.return_code !== 0 || !!data.error?.trim() || data.return_code === -200 || (isFGTExecution && data.return_code !== 0);

        if (!hasError && !stdoutLooksLikeError) toast.update(toastId, { render: "Thực thi thành công!", type: "success", isLoading: false, autoClose: 3000 });
        else if (!hasError && stdoutLooksLikeError) toast.update(toastId, { render: "Đã thực thi, output có thể chứa vấn đề.", type: "warning", isLoading: false, autoClose: 5000 });
        else toast.update(toastId, { render: data.error === 'Timeout' ? "Thực thi quá tgian." : (data.error || "Thực thi thất bại/có lỗi."), type: "error", isLoading: false, autoClose: 5000 });

    } catch (err: any) {
         resultData = { message: err.message || "Lỗi thực thi.", output: "", error: err.message || "Lỗi không xác định", return_code: -200, codeThatFailed: codeToExecute, executed_file_type: execType };
        toast.update(toastId, { render: `Lỗi thực thi: ${resultData.error}`, type: "error", isLoading: false, autoClose: 5000 });
    } finally {
        setIsExecuting(false);
        if (resultData) {
             const blockToAdd: ConversationBlock = { type: 'execution', data: resultData, id: executionBlockId, timestamp: now, isNew: true, thoughts: (resultData as any).thoughts || [], parentConversation: newConvForExec };
             
             setConversation(prev => {
                const currentConv = [...prev]; // Make a new mutable copy
                const insertAtIndex = currentConv.findIndex(b => b.id === blockId);
                if (insertAtIndex !== -1) {
                    currentConv.splice(insertAtIndex + 1, 0, blockToAdd);
                } else {
                    currentConv.push(blockToAdd);
                }
                return currentConv.map(b => ({ ...b, parentConversation: currentConv }));
             });
        }
    }
  }, [runAsAdmin, conversation, sendApiRequest, editingBlockId, currentEditingCode, addThoughtsAndResultToConversation]);


  const handleDebug = useCallback(async (codeToDebugFromExecResult: string | null, lastExecutionResult: ExecutionResult | null, blockIdOfExecution: string) => {
       const hasErrorSignal = (execResult: ExecutionResult | null): boolean => {
           if (!execResult) return false;
           const keywords = ['lỗi', 'error', 'fail', 'cannot', 'unable', 'traceback', 'exception', 'not found', 'không tìm thấy', 'invalid', 'command parse error', 'command_cli_error'];
           const isFGTError = execResult.executed_file_type === 'fortios' && execResult.return_code !== 0;
           return execResult.return_code !== 0 || !!execResult.error?.trim() || execResult.return_code === -200 || isFGTError || (!!execResult.output?.trim() && keywords.some(kw => execResult.output!.toLowerCase().includes(kw)));
       };

       let codeForDebugging = codeToDebugFromExecResult;
       const executionBlock = conversation.find(b => b.id === blockIdOfExecution);
       const fullConversationContextForDebug = executionBlock?.parentConversation || conversation;
       const executionBlockIndex = fullConversationContextForDebug.findIndex(b => b.id === blockIdOfExecution);

       let originalAICodeBlock: ConversationBlock | undefined;
       if (executionBlockIndex > -1) {
           for (let i = executionBlockIndex - 1; i >= 0; i--) {
               if (fullConversationContextForDebug[i].type === 'ai-code') {
                   originalAICodeBlock = fullConversationContextForDebug[i];
                   break;
               }
           }
       }
       if (originalAICodeBlock && editingBlockId === originalAICodeBlock.id && currentEditingCode !== null) {
           codeForDebugging = currentEditingCode;
       }

       if (!codeForDebugging || !hasErrorSignal(lastExecutionResult)) {
           toast.warn("Cần mã/lệnh và kết quả lỗi để gỡ rối."); return;
       }
       const fileTypeToSend = lastExecutionResult?.executed_file_type || 'py';

       setIsDebugging(true);
       const now = new Date().toISOString();
       const loadingId = Date.now().toString() + '_dload';
       const loadingBlock: ConversationBlock = { type: 'loading', data: 'Đang gỡ rối...', id: loadingId, timestamp: now, isNew: true, thoughts: [], parentConversation: fullConversationContextForDebug };
       
       const newConvWithLoading = [...fullConversationContextForDebug];
       if (executionBlockIndex !== -1) newConvWithLoading.splice(executionBlockIndex + 1, 0, loadingBlock); 
       else newConvWithLoading.push(loadingBlock);
       setConversation(newConvWithLoading.map(b => ({ ...b, parentConversation: newConvWithLoading })));


       let userPromptForDebug = "(Ko tìm thấy prompt gốc)";
       const searchEndIndex = originalAICodeBlock ? fullConversationContextForDebug.findIndex(b => b.id === originalAICodeBlock!.id) : executionBlockIndex;
       if (searchEndIndex > -1) {
           for (let i = searchEndIndex - 1; i >= 0; i--) {
               if (fullConversationContextForDebug[i].type === 'user') {
                   userPromptForDebug = fullConversationContextForDebug[i].data;
                   break;
               }
           }
       }

       try {
           const payload: any = {
               prompt: userPromptForDebug,
               code: codeForDebugging,
               stdout: lastExecutionResult?.output ?? '',
               stderr: lastExecutionResult?.error ?? '',
               file_type: fileTypeToSend,
           };
           const data: DebugResult = await sendApiRequest('debug', payload) as DebugResult;
           addThoughtsAndResultToConversation(loadingId, data as ApiResponseWithThoughts, 'debug', d => d);
           toast.success("Đã phân tích gỡ rối!");
       } catch (err: any) {
           const errorData: DebugResult = { explanation: null, corrected_code: null, error: err.message };
           addThoughtsAndResultToConversation(loadingId, { ...errorData, thoughts: err.thoughts } as ApiResponseWithThoughts, 'debug', d => d);
           toast.error(`Gỡ rối thất bại: ${err.message}`);
       } finally { setIsDebugging(false); }
   }, [conversation, sendApiRequest, editingBlockId, currentEditingCode, addThoughtsAndResultToConversation]);

   const applyCorrectedCode = useCallback((correctedCode: string, originalDebugBlockId: string) => {
       const debugBlock = conversation.find(b => b.id === originalDebugBlockId);
       const fullConversationContext = debugBlock?.parentConversation || conversation;
       const newGeneratedType = debugBlock?.data?.original_language || 'py';

       const newBlock: ConversationBlock = {
           type: 'ai-code', data: correctedCode, generatedType: newGeneratedType,
           id: Date.now().toString() + '_ac', timestamp: new Date().toISOString(),
           isNew: true, thoughts: [], parentConversation: fullConversationContext
       };
       const originalBlockIndex = fullConversationContext.findIndex(b => b.id === originalDebugBlockId);
       
       const newConv = [...fullConversationContext];
       if (originalBlockIndex !== -1) newConv.splice(originalBlockIndex + 1, 0, newBlock); 
       else newConv.push(newBlock);
       setConversation(newConv.map(b => ({ ...b, parentConversation: newConv })));

       setEditingBlockId(newBlock.id);
       setCurrentEditingCode(correctedCode);

       toast.success("Đã áp dụng code sửa lỗi. Bạn có thể sửa thêm hoặc thực thi.");
   }, [conversation]);

  const handleInstallPackage = useCallback(async (packageName: string, originalDebugBlockId: string) => {
     if (!packageName) { toast.warn("Ko có tên package."); return; }
     setIsInstalling(true);
     const toastId = toast.loading(`Đang cài ${packageName}...`);
     const installBlockId = Date.now().toString() + '_inst';
     const now = new Date().toISOString();
     
     const debugBlock = conversation.find(b => b.id === originalDebugBlockId);
     const fullConversationContext = debugBlock?.parentConversation || conversation;
     const originalBlockIndex = fullConversationContext.findIndex(b => b.id === originalDebugBlockId);
     // No loading block for install, add result directly
     
     let resultData : InstallationResult | null = null;

     try {
         const response = await fetch('http://localhost:5001/api/install_package', {
             method: 'POST', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ package_name: packageName }),
         });
         const data: InstallationResult = await response.json();
         resultData = { ...data, package_name: packageName };
         if (data.success) toast.update(toastId, { render: `Cài ${packageName} thành công!`, type: "success", isLoading: false, autoClose: 4000 });
         else {
             const errMsg = data.error || data.output || "Cài đặt thất bại.";
             toast.update(toastId, { render: `Cài ${packageName} thất bại. ${errMsg.split('\n')[0]}`, type: "error", isLoading: false, autoClose: 6000 });
         }
     } catch (err: any) {
         resultData = { success: false, message: `Lỗi kết nối khi cài.`, output: "", error: err.message, package_name: packageName };
         toast.update(toastId, { render: `Lỗi cài đặt: ${err.message}`, type: "error", isLoading: false, autoClose: 5000 });
     } finally {
         setIsInstalling(false);
          if (resultData) {
              const blockToAdd: ConversationBlock = { type: 'installation', data: resultData, id: installBlockId, timestamp: now, isNew: true, thoughts: [], parentConversation: fullConversationContext };
              
              setConversation(prev => {
                  const currentConv = [...prev]; // Use the most recent state for prev
                  const insertAtIndex = currentConv.findIndex(b => b.id === originalDebugBlockId);
                  if (insertAtIndex !== -1) {
                      currentConv.splice(insertAtIndex + 1, 0, blockToAdd);
                  } else {
                      currentConv.push(blockToAdd);
                  }
                  return currentConv.map(b => ({ ...b, parentConversation: currentConv }));
              });
          }
     }
  }, [conversation]);

  const handleExplain = useCallback(async (blockId: string, contentToExplain: any, context: string) => {
    const blockToExplain = conversation.find(b => b.id === blockId);
    const fullConversationContext = blockToExplain?.parentConversation || conversation;
    const fileTypeToSend = (context === 'code') ? blockToExplain?.generatedType : undefined;

    setIsExplaining(true);
    const now = new Date().toISOString();
    const loadingId = Date.now().toString() + '_explload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: `Đang giải thích...`, id: loadingId, timestamp: now, isNew: true, thoughts: [], parentConversation: fullConversationContext };
    const originalBlockIndex = fullConversationContext.findIndex(b => b.id === blockId);
    
    const newConvWithLoading = [...fullConversationContext];
    if (originalBlockIndex !== -1) newConvWithLoading.splice(originalBlockIndex + 1, 0, loadingBlock); 
    else newConvWithLoading.push(loadingBlock);
    setConversation(newConvWithLoading.map(b => ({ ...b, parentConversation: newConvWithLoading })));

    let processedContent = contentToExplain;
    if (context === 'code' && editingBlockId === blockId && currentEditingCode !== null) {
        processedContent = currentEditingCode;
    } else if (typeof contentToExplain === 'object' && contentToExplain !== null) {
        try {
            let contentToSend = { ...contentToExplain };
            if ((context === 'execution_result' || context === 'debug_result') && 'codeThatFailed' in contentToSend) {
                delete contentToSend.codeThatFailed;
            }
            processedContent = JSON.stringify(contentToSend, null, 2);
        } catch { processedContent = String(contentToExplain); }
    } else {
        processedContent = String(contentToExplain);
    }

    try {
        const payload:any = {
            content: processedContent,
            context,
        };
        if (fileTypeToSend) payload.file_type = fileTypeToSend;

        const data: ExplainResult = await sendApiRequest('explain', payload) as ExplainResult;
        addThoughtsAndResultToConversation(loadingId, data as ApiResponseWithThoughts, 'explanation', d => d);
        toast.success("Đã tạo giải thích!");
    } catch (err: any) {
        const errorData: ExplainResult = { error: err.message || 'Lỗi giải thích.' };
        addThoughtsAndResultToConversation(loadingId, {...errorData, thoughts: err.thoughts } as ApiResponseWithThoughts, 'explanation', d => d);
        toast.error(err.message || 'Lỗi giải thích.');
    } finally { setIsExplaining(false); }
  }, [sendApiRequest, conversation, editingBlockId, currentEditingCode, addThoughtsAndResultToConversation]);

  useEffect(() => {
    localStorage.setItem(FGT_CONTEXT_COMMANDS_STORAGE_KEY, JSON.stringify(fortiGateContextCommands));
  }, [fortiGateContextCommands]);

  const isBusyOverall = isLoading || isExecuting || isReviewing || isDebugging || isInstalling || isExplaining;

  return (
    <div className="main-container">
      <ToastContainer theme="dark" position="bottom-right" autoClose={4000} hideProgressBar={false} newestOnTop={false} closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover />
      <CenterArea
        conversation={conversation}
        isLoading={isLoading}
        isBusy={isBusyOverall}
        prompt={prompt}
        setPrompt={setPrompt}
        onPrimarySubmit={handleGenerateOrFortiGateChat}
        onReview={handleReviewCode}
        onExecute={handleExecute}
        onDebug={handleDebug}
        onApplyCorrectedCode={applyCorrectedCode}
        onInstallPackage={handleInstallPackage}
        onExplain={handleExplain}
        collapsedStates={collapsedStates}
        onToggleCollapse={toggleCollapse}
        expandedOutputs={expandedOutputs}
        onToggleOutputExpand={onToggleOutputExpand}
        onToggleSidebar={handleToggleSidebar}
        targetOs={targetOs}
        isFortiGateInteractiveMode={isFortiGateInteractiveMode}
        onToggleFortiGateInteractiveMode={toggleFortiGateInteractiveMode}
        editingBlockId={editingBlockId}
        currentEditingCode={currentEditingCode}
        onToggleEditCode={handleToggleEditCode}
        onUpdateEditingCode={handleUpdateEditingCode}
        onSaveEditedCode={handleSaveEditedCode}
        onCancelEditCode={handleCancelEditCode}
        backendLogs={backendLogs}
        isLogViewerVisible={isLogViewerVisible}
        onToggleLogViewer={toggleLogViewer}
      />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        modelConfig={modelConfig}
        onConfigChange={handleConfigChange}
        onSaveSettings={handleSaveSettings}
        isBusy={isBusyOverall}
        runAsAdmin={runAsAdmin}
        uiApiKey={uiApiKey}
        useUiApiKey={useUiApiKey}
        onApplyUiApiKey={handleApplyUiApiKey}
        onUseEnvKey={handleUseEnvKey}
        targetOs={targetOs}
        fileType={fileType}
        customFileName={customFileName}
        fortiGateConfig={fortiGateConfig}
        fortiGateContextCommandsConfig={{
          list: DEFAULT_FORTIGATE_CONTEXT_COMMANDS,
          selected: fortiGateContextCommands,
        }}
      />
    </div>
  );
}
export default App;