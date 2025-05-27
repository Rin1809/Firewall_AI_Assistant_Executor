// frontend/src/App.tsx
import React, { useState, ChangeEvent, useEffect, useCallback } from 'react';
import CenterArea from './components/CenterArea';
import Sidebar from './components/Sidebar';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import { FiCheckSquare, FiSquare, FiEdit, FiSave } from 'react-icons/fi'; // Thêm icons

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

export interface ConversationBlock {
    type: 'user' | 'ai-code' | 'review' | 'execution' | 'debug' | 'loading' | 'error' | 'installation' | 'explanation' | 'placeholder';
    data: any;
    id: string;
    timestamp: string;
    isNew?: boolean; // Thêm thuộc tính isNew
    generatedType?: string;
    // Thêm parentConversation để InteractionBlock có thể truy cập
    // Tuy nhiên, cách này có thể làm phức tạp state. Xem xét lại nếu cần.
    // Tạm thời bỏ qua, sẽ xử lý logic tìm code gốc trong App.tsx
    // parentConversation?: ConversationBlock[];
}
// ---------------------------------------------

// --- CONSTANTS ---
const MODEL_NAME_STORAGE_KEY = 'geminiExecutorModelName';
const FORTIGATE_CONFIG_STORAGE_KEY = 'geminiExecutorFortiGateConfig';
const TARGET_OS_STORAGE_KEY = 'geminiExecutorTargetOS';
const FILE_TYPE_STORAGE_KEY = 'geminiExecutorFileType';
const CUSTOM_FILE_NAME_STORAGE_KEY = 'geminiExecutorCustomFileName';
const FGT_INTERACTIVE_MODE_STORAGE_KEY = 'geminiExecutorFgtInteractiveMode';
const FGT_CONTEXT_COMMANDS_STORAGE_KEY = 'geminiExecutorFgtContextCommands'; // Luu lua chon cmd FGT

const NEW_BLOCK_ANIMATION_DURATION = 500; // ms, thời gian animation chạy

// Danh sach lenh mac dinh cho FGT context (giong backend)
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

  // State luu tru cac lenh FGT context da chon
  const [fortiGateContextCommands, setFortiGateContextCommands] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(FGT_CONTEXT_COMMANDS_STORAGE_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) { console.error("Loi phan tich cmd FGT context da luu", e); }
    }
    const initial: Record<string, boolean> = {};
    DEFAULT_FORTIGATE_CONTEXT_COMMANDS.forEach(cmd => initial[cmd] = true); // Mac dinh chon het
    return initial;
  });

  // State cho việc chỉnh sửa code
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [currentEditingCode, setCurrentEditingCode] = useState<string | null>(null);

  // Effect để clear cờ isNew sau khi animation
   useEffect(() => {
        const newBlockIds = conversation.filter(b => b.isNew).map(b => b.id);
        if (newBlockIds.length > 0) {
            const timer = setTimeout(() => {
                setConversation(prevConv =>
                    prevConv.map(b => (newBlockIds.includes(b.id) ? { ...b, isNew: false } : b))
                );
            }, NEW_BLOCK_ANIMATION_DURATION + 150); // Thêm chút delay
            return () => clearTimeout(timer);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(conversation.filter(b => b.isNew).map(b => b.id))]); // Chỉ chạy khi ds ID block isNew thay đổi


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

    // Xu ly thay doi lua chon cmd FGT context
    if (name.startsWith('fgtCtxCmd_')) {
        const cmd = name.substring('fgtCtxCmd_'.length);
        if (cmd === 'selectAll') { // Xu ly nut select all
            const newStates: Record<string, boolean> = {};
            DEFAULT_FORTIGATE_CONTEXT_COMMANDS.forEach(c => newStates[c] = checked);
            setFortiGateContextCommands(newStates);
        } else {
            setFortiGateContextCommands(prev => ({ ...prev, [cmd]: checked }));
        }
        return; // Ko xu ly tiep cac case khac
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

  // ----- Hàm xử lý chỉnh sửa code -----
  const handleToggleEditCode = useCallback((blockIdToEdit: string, codeInBlockData: string) => {
    if (editingBlockId === blockIdToEdit) { // Đang sửa block này, muốn thoát/hủy
        setEditingBlockId(null);
        setCurrentEditingCode(null);
        toast.info("Đã hủy chỉnh sửa.");
    } else { // Muốn sửa block này (hoặc chuyển từ block khác)
        if (editingBlockId && currentEditingCode !== null) {
            // Tự động hủy thay đổi của block cũ nếu có
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
            b.id === blockIdToSave ? { ...b, data: currentEditingCode, isNew: true } : b // Đánh dấu là isNew để có thể có animation
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
  // ----- Hết hàm xử lý chỉnh sửa code -----


  const sendApiRequest = useCallback(async (endpoint: string, body: any, isFortiGateExecutionForExecuteEndpoint: boolean = false) => {
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
        if (!fortiGateConfig.ipHost || !fortiGateConfig.username) {
            if (endpoint !== 'fortigate_chat') { // Không báo lỗi cho chat, để chat có thể xử lý trường hợp này
                 toast.error("Thiếu IP/Host & Username FortiGate trong Cài đặt để lấy ngữ cảnh.");
            }
            // Vẫn tiếp tục gửi request, backend sẽ xử lý việc thiếu context
        }
        // Them ds lenh ctx FGT da chon vao body request
        const selectedCommands = Object.entries(fortiGateContextCommands)
                                     .filter(([, isSelected]) => isSelected)
                                     .map(([cmd]) => cmd);
        // Luôn gửi key này, dù rỗng, để backend biết FE đã có logic chọn lệnh
        finalBody.fortigate_selected_context_commands = selectedCommands;


        // Khi debug hoặc chat, truyền đầy đủ config của FGT để backend có thể lấy context mới nhất nếu cần
        if (endpoint === 'debug') finalBody.fortigate_config_for_context = fortiGateConfig;
        else finalBody.fortigate_config = fortiGateConfig; // Cho generate, chat
    }

    // Trường hợp đặc biệt cho /execute FortiGate, cần config đầy đủ
    if (endpoint === 'execute' && isFortiGateExecutionForExecuteEndpoint) {
        if (!fortiGateConfig.ipHost || !fortiGateConfig.username) {
            toast.error("Vui lòng nhập đủ thông tin kết nối FortiGate trong Cài đặt (IP/Host & Username).");
            setIsSidebarOpen(true); // Mở sidebar để người dùng nhập
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
        const data = await response.json();
        if (!response.ok) {
            let errorMsg = data?.error || `Lỗi ${response.status} từ /api/${endpoint}`;
            throw new Error(errorMsg);
        }
        return data;
    } catch (error: any) {
         clearTimeout(timeoutId);
         if (error.name === 'AbortError') throw new Error(`Yêu cầu đến /api/${endpoint} quá thời gian.`);
         throw error;
    }
  }, [modelConfig, useUiApiKey, uiApiKey, fortiGateConfig, fortiGateContextCommands]);

  const handleGenerate = useCallback(async (currentPrompt: string) => {
    setIsLoading(true);
    const now = new Date().toISOString();
    const newCollapsedStates: Record<string, boolean> = {};
    conversation.filter(b => b.type === 'user').forEach(block => { newCollapsedStates[block.id] = true; });
    setCollapsedStates(prev => ({ ...prev, ...newCollapsedStates }));

    const userBlockTypeSuffix = targetOs === 'fortios' && isFortiGateInteractiveMode ? '_u_fgt_interactive' : '_u_gen';
    const newUserBlock: ConversationBlock = { type: 'user', data: currentPrompt, id: Date.now().toString() + userBlockTypeSuffix, timestamp: now, isNew: true };
    const loadingId = Date.now().toString() + '_gload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: targetOs === 'fortios' && isFortiGateInteractiveMode ? 'Đang tạo lệnh FortiGate...' : 'Đang tạo...', id: loadingId, timestamp: now, isNew: true };

    setConversation(prev => [...prev, newUserBlock, loadingBlock]);
    setCollapsedStates(prev => ({ ...prev, [newUserBlock.id]: false })); // Mở block user mới nhất

    const finalFileTypeForRequest = fileType === 'other' ? customFileName.trim() || 'txt' : fileType;
    const bodyForGenerate: any = {
        prompt: currentPrompt,
        target_os: targetOs,
        file_type: finalFileTypeForRequest
        // fortiGateConfig và fortiGateContextCommands sẽ được thêm bởi sendApiRequest nếu cần
    };

    try {
      const data = await sendApiRequest('generate', bodyForGenerate);
      setConversation(prev => prev.map(b =>
            b.id === loadingId
            ? { type: 'ai-code', data: data.code, generatedType: data.generated_for_type, id: Date.now().toString() + '_a', timestamp: new Date().toISOString(), isNew: true }
            : b
        ));
      toast.success(data.generated_for_type === 'fortios' ? "Đã tạo lệnh FortiGate!" : "Đã tạo mã!");
      setPrompt('');
    } catch (err: any) {
      const errorMessage = err.message || 'Lỗi tạo mã/lệnh.';
      toast.error(errorMessage);
      setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'error', data: errorMessage, id: Date.now().toString() + '_err', timestamp: new Date().toISOString(), isNew: true } : b));
    } finally { setIsLoading(false); }
  }, [sendApiRequest, conversation, setPrompt, fileType, customFileName, targetOs, isFortiGateInteractiveMode /*, fortiGateConfig, fortiGateContextCommands removed as they are handled by sendApiRequest */]);

  const handleFortiGateChat = useCallback(async (currentPrompt: string) => {
    setIsLoading(true);
    const now = new Date().toISOString();
    const newCollapsedStates: Record<string, boolean> = {};
    conversation.filter(b => b.type === 'user').forEach(block => { newCollapsedStates[block.id] = true; });
    setCollapsedStates(prev => ({ ...prev, ...newCollapsedStates }));

    const newUserBlock: ConversationBlock = { type: 'user', data: currentPrompt, id: Date.now().toString() + '_u_chat', timestamp: now, isNew: true };
    const loadingId = Date.now().toString() + '_chatload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: 'FortiAI đang nghĩ...', id: loadingId, timestamp: now, isNew: true };

    setConversation(prev => [...prev, newUserBlock, loadingBlock]);
    setCollapsedStates(prev => ({ ...prev, [newUserBlock.id]: false }));

    const relevantHistoryTypesForFgtChat: ConversationBlock['type'][] = [
      'user', 'ai-code', 'execution', 'explanation',
    ];
    const MAX_HISTORY_BLOCKS_FOR_CHAT = 10;
    const historyForChatContext = conversation
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
        } else { return null; }
        return `${blockTypeLabel}\n${content.trim()}`;
      })
      .filter(item => item !== null)
      .join('\n\n---\n\n');

    try {
      const data = await sendApiRequest('fortigate_chat', {
        prompt: currentPrompt,
        conversation_history_for_chat_context: historyForChatContext || "(Không có lịch sử FortiOS gần đây)",
        // fortiGateConfig và fortiGateContextCommands sẽ được thêm bởi sendApiRequest
      }, false); // isFortiGateExecutionForExecuteEndpoint = false

      setConversation(prev => prev.map(b =>
        b.id === loadingId
        ? { type: 'explanation', data: { explanation: data.chat_response }, id: Date.now().toString() + '_chat_res', timestamp: new Date().toISOString(), isNew: true }
        : b
      ));
      toast.success("FortiAI đã trả lời!");
      setPrompt('');
    } catch (err: any) {
      const errorMessage = err.message || 'Lỗi khi chat với FortiGate.';
      toast.error(errorMessage);
      setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'error', data: errorMessage, id: Date.now().toString() + '_chaterr', timestamp: new Date().toISOString(), isNew: true } : b));
    } finally { setIsLoading(false); }
  }, [sendApiRequest, conversation, setPrompt /*, fortiGateConfig, fortiGateContextCommands removed */]);

  const handleGenerateOrFortiGateChat = useCallback(async (currentPrompt: string) => {
    if (!currentPrompt.trim()) {
        toast.warn('Vui lòng nhập yêu cầu.');
        return;
    }
    if (targetOs === 'fortios') {
        if (isFortiGateInteractiveMode) {
            await handleGenerate(currentPrompt);
        } else {
            await handleFortiGateChat(currentPrompt);
        }
    } else {
        await handleGenerate(currentPrompt);
    }
  }, [targetOs, isFortiGateInteractiveMode, handleGenerate, handleFortiGateChat]);

  const handleReviewCode = useCallback(async (codeToReviewFromBlock: string | null, blockId: string) => {
    const blockToReview = conversation.find(b => b.id === blockId);
    let codeToReview = codeToReviewFromBlock;
    // Nếu block này đang được sửa, dùng code đang sửa
    if (blockToReview?.type === 'ai-code' && editingBlockId === blockId && currentEditingCode !== null) {
        codeToReview = currentEditingCode;
    }
    if (!codeToReview) { toast.warn("Ko có mã/lệnh để review."); return; }

    const fileTypeToSend = blockToReview?.generatedType || 'py'; // Lấy generatedType từ block gốc

    setIsReviewing(true);
    const now = new Date().toISOString();
    const loadingId = Date.now().toString() + '_rload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: 'Đang đánh giá...', id: loadingId, timestamp: now, isNew: true };
    const originalBlockIndex = conversation.findIndex(b => b.id === blockId);
    const newConv = [...conversation];
    if (originalBlockIndex !== -1) newConv.splice(originalBlockIndex + 1, 0, loadingBlock); else newConv.push(loadingBlock);
    setConversation(newConv);

    try {
        const data: ReviewResult = await sendApiRequest('review', { code: codeToReview, file_type: fileTypeToSend });
        setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'review', data, id: Date.now().toString() + '_r', timestamp: new Date().toISOString(), isNew: true } : b));
        toast.success("Đã đánh giá xong!");
    } catch (err: any) {
        const errorData: ReviewResult = { error: err.message || 'Lỗi review.' };
        setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'review', data: errorData, id: Date.now().toString() + '_rerr', timestamp: new Date().toISOString(), isNew: true } : b));
        toast.error(err.message || 'Lỗi review.');
    } finally { setIsReviewing(false); }
  }, [sendApiRequest, conversation, editingBlockId, currentEditingCode]);

  const handleExecute = useCallback(async (codeToExecuteFromBlock: string | null, blockId: string) => {
    const blockToExecute = conversation.find(b => b.id === blockId);
    let codeToExecute = codeToExecuteFromBlock;
    // Nếu block này đang được sửa, dùng code đang sửa
     if (blockToExecute?.type === 'ai-code' && editingBlockId === blockId && currentEditingCode !== null) {
        codeToExecute = currentEditingCode;
    }
    if (!codeToExecute) { toast.warn("Ko có mã/lệnh để thực thi."); return; }

    const execType = blockToExecute?.generatedType || 'py'; // Lấy generatedType từ block gốc

    setIsExecuting(true);
    const isFGTExecution = execType === 'fortios';
    const toastMsg = isFGTExecution ? 'Đang gửi lệnh tới FortiGate...' : `Đang thực thi ${runAsAdmin ? ' với quyền Admin/Root' : ''}...`;
    const toastId = toast.loading(toastMsg);
    const executionBlockId = Date.now().toString() + '_ex';
    const now = new Date().toISOString();
    const executionBlockBase: Partial<ConversationBlock> = { type: 'execution', id: executionBlockId, timestamp: now, isNew: true };
    const originalBlockIndex = conversation.findIndex(b => b.id === blockId);
    const newConv = [...conversation];
    let resultData: ExecutionResult | null = null;

    const endpoint = 'execute';
    let payload: any = { code: codeToExecute, file_type: execType };
    if (!isFGTExecution) { // Chỉ thêm run_as_admin nếu không phải FGT
        payload.run_as_admin = runAsAdmin;
    }
    // fortiGateConfig sẽ được thêm bởi sendApiRequest nếu isFGTExecution là true

    try {
        const data: ExecutionResult = await sendApiRequest(endpoint, payload, isFGTExecution);
        resultData = { ...data, codeThatFailed: codeToExecute, executed_file_type: execType }; // Luu code da thuc thi

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
             const blockToAdd = { ...executionBlockBase, data: resultData } as ConversationBlock;
             if (originalBlockIndex !== -1) { newConv.splice(originalBlockIndex + 1, 0, blockToAdd); setConversation(newConv); }
             else setConversation(prev => [...prev, blockToAdd]);
        }
    }
  }, [runAsAdmin, conversation, sendApiRequest, editingBlockId, currentEditingCode /*, fortiGateConfig removed */]);


  const handleDebug = useCallback(async (codeToDebugFromExecResult: string | null, lastExecutionResult: ExecutionResult | null, blockIdOfExecution: string) => {
       const hasErrorSignal = (execResult: ExecutionResult | null): boolean => {
           if (!execResult) return false;
           const keywords = ['lỗi', 'error', 'fail', 'cannot', 'unable', 'traceback', 'exception', 'not found', 'không tìm thấy', 'invalid', 'command parse error', 'command_cli_error'];
           const isFGTError = execResult.executed_file_type === 'fortios' && execResult.return_code !== 0;
           return execResult.return_code !== 0 || !!execResult.error?.trim() || execResult.return_code === -200 || isFGTError || (!!execResult.output?.trim() && keywords.some(kw => execResult.output!.toLowerCase().includes(kw)));
       };

       let codeForDebugging = codeToDebugFromExecResult; // Đây là code đã thực thi gây lỗi (codeThatFailed)

       // Tìm block ai-code gốc đứng TRƯỚC block execution bị lỗi
       const executionBlockIndex = conversation.findIndex(b => b.id === blockIdOfExecution);
       let originalAICodeBlock: ConversationBlock | undefined;
       if (executionBlockIndex > -1) {
           for (let i = executionBlockIndex - 1; i >= 0; i--) {
               if (conversation[i].type === 'ai-code') {
                   originalAICodeBlock = conversation[i];
                   break;
               }
           }
       }

       // Nếu block AI code gốc đó đang được sửa, thì code để debug phải là code đang sửa
       if (originalAICodeBlock && editingBlockId === originalAICodeBlock.id && currentEditingCode !== null) {
           codeForDebugging = currentEditingCode;
       }


       if (!codeForDebugging || !hasErrorSignal(lastExecutionResult)) {
           toast.warn("Cần mã/lệnh và kết quả lỗi để gỡ rối."); return;
       }

       const fileTypeToSend = lastExecutionResult?.executed_file_type || 'py'; // Loại file của code gây lỗi

       setIsDebugging(true);
       const now = new Date().toISOString();
       const loadingId = Date.now().toString() + '_dload';
       const loadingBlock: ConversationBlock = { type: 'loading', data: 'Đang gỡ rối...', id: loadingId, timestamp: now, isNew: true };
       const originalBlockIndex = conversation.findIndex(b => b.id === blockIdOfExecution);
       const newConv = [...conversation];
       if (originalBlockIndex !== -1) newConv.splice(originalBlockIndex + 1, 0, loadingBlock); else newConv.push(loadingBlock);
       setConversation(newConv);

       let userPromptForDebug = "(Ko tìm thấy prompt gốc)";
       // Tìm user prompt gần nhất TRƯỚC block AI code gốc (nếu tìm được) hoặc trước block execution
       const searchEndIndex = originalAICodeBlock ? conversation.findIndex(b => b.id === originalAICodeBlock!.id) : executionBlockIndex;
       if (searchEndIndex > -1) {
           for (let i = searchEndIndex - 1; i >= 0; i--) {
               if (conversation[i].type === 'user') {
                   userPromptForDebug = conversation[i].data;
                   break;
               }
           }
       }


       try {
           const payload: any = {
               prompt: userPromptForDebug,
               code: codeForDebugging, // Dùng code đã được xác định (có thể là code đang sửa)
               stdout: lastExecutionResult?.output ?? '',
               stderr: lastExecutionResult?.error ?? '',
               file_type: fileTypeToSend,
               // fortiGateConfigForContext và fortiGateSelectedContextCommands sẽ được thêm bởi sendApiRequest nếu cần
           };

           const data: DebugResult = await sendApiRequest('debug', payload);
           setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'debug', data, id: Date.now().toString() + '_dbg', timestamp: new Date().toISOString(), isNew: true } : b));
           toast.success("Đã phân tích gỡ rối!");
       } catch (err: any) {
           const errorData: DebugResult = { explanation: null, corrected_code: null, error: err.message };
           setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'debug', data: errorData, id: Date.now().toString() + '_dbgerr', timestamp: new Date().toISOString(), isNew: true } : b));
           toast.error(`Gỡ rối thất bại: ${err.message}`);
       } finally { setIsDebugging(false); }
   }, [conversation, sendApiRequest, editingBlockId, currentEditingCode /*, fortiGateConfig, fortiGateContextCommands removed */]);

   const applyCorrectedCode = useCallback((correctedCode: string, originalDebugBlockId: string) => {
       const debugBlock = conversation.find(b => b.id === originalDebugBlockId);
       const newGeneratedType = debugBlock?.data?.original_language || 'py'; // Lấy ngôn ngữ từ debug result

       const newBlock: ConversationBlock = {
           type: 'ai-code',
           data: correctedCode,
           generatedType: newGeneratedType,
           id: Date.now().toString() + '_ac',
           timestamp: new Date().toISOString(),
           isNew: true
       };
       const originalBlockIndex = conversation.findIndex(b => b.id === originalDebugBlockId);
       const newConv = [...conversation];
       if (originalBlockIndex !== -1) newConv.splice(originalBlockIndex + 1, 0, newBlock); else newConv.push(newBlock);
       setConversation(newConv);

       // Tự động vào chế độ sửa cho block code mới này
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
     const installBlockBase: Partial<ConversationBlock> = { type: 'installation', id: installBlockId, timestamp: now, isNew: true };
     const originalBlockIndex = conversation.findIndex(b => b.id === originalDebugBlockId);
     const newConv = [...conversation];
     let resultData : InstallationResult | null = null;

     try {
         // sendApiRequest không dùng cho install_package vì nó không cần model_config
         const response = await fetch('http://localhost:5001/api/install_package', {
             method: 'POST', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ package_name: packageName }),
         });
         const data: InstallationResult = await response.json();
         resultData = { ...data, package_name: packageName }; // Đảm bảo package_name có trong kết quả
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
          if (resultData) { // Luôn thêm block kết quả, dù thành công hay thất bại
              const blockToAdd = { ...installBlockBase, data: resultData } as ConversationBlock;
              if (originalBlockIndex !== -1) { newConv.splice(originalBlockIndex + 1, 0, blockToAdd); setConversation(newConv); }
              else setConversation(prev => [...prev, blockToAdd]);
          }
     }
  }, [conversation]); // sendApiRequest không dùng ở đây

  const handleExplain = useCallback(async (blockId: string, contentToExplain: any, context: string) => {
    const blockToExplain = conversation.find(b => b.id === blockId);
    const fileTypeToSend = (context === 'code') ? blockToExplain?.generatedType : undefined; // Chỉ gửi file_type nếu context là 'code'

    setIsExplaining(true);
    const now = new Date().toISOString();
    const loadingId = Date.now().toString() + '_explload';
    const loadingBlock: ConversationBlock = { type: 'loading', data: `Đang giải thích...`, id: loadingId, timestamp: now, isNew: true };
    const originalBlockIndex = conversation.findIndex(b => b.id === blockId);
    const newConv = [...conversation];
    if (originalBlockIndex !== -1) newConv.splice(originalBlockIndex + 1, 0, loadingBlock); else newConv.push(loadingBlock);
    setConversation(newConv);

    let processedContent = contentToExplain;
    // Xử lý code đang sửa cho context 'code'
    if (context === 'code' && editingBlockId === blockId && currentEditingCode !== null) {
        processedContent = currentEditingCode;
    } else if (typeof contentToExplain === 'object' && contentToExplain !== null) {
        try {
            let contentToSend = { ...contentToExplain };
            // Loại bỏ codeThatFailed khỏi execution_result và debug_result trước khi gửi đi giải thích
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

        const data: ExplainResult = await sendApiRequest('explain', payload);
        setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'explanation', data, id: Date.now().toString() + '_exp', timestamp: new Date().toISOString(), isNew: true } : b));
        toast.success("Đã tạo giải thích!");
    } catch (err: any) {
        const errorData: ExplainResult = { error: err.message || 'Lỗi giải thích.' };
        setConversation(prev => prev.map(b => b.id === loadingId ? { type: 'explanation', data: errorData, id: Date.now().toString() + '_experr', timestamp: new Date().toISOString(), isNew: true } : b));
        toast.error(err.message || 'Lỗi giải thích.');
    } finally { setIsExplaining(false); }
  }, [sendApiRequest, conversation, editingBlockId, currentEditingCode]);

  // Luu lua chon cmd FGT context vao localStorage
  useEffect(() => {
    localStorage.setItem(FGT_CONTEXT_COMMANDS_STORAGE_KEY, JSON.stringify(fortiGateContextCommands));
  }, [fortiGateContextCommands]);

  const isBusy = isLoading || isExecuting || isReviewing || isDebugging || isInstalling || isExplaining;

  return (
    <div className="main-container">
      <ToastContainer theme="dark" position="bottom-right" autoClose={4000} hideProgressBar={false} newestOnTop={false} closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover />
      <CenterArea
        conversation={conversation}
        isLoading={isLoading}
        isBusy={isBusy}
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
        // Props cho chỉnh sửa code
        editingBlockId={editingBlockId}
        currentEditingCode={currentEditingCode}
        onToggleEditCode={handleToggleEditCode}
        onUpdateEditingCode={handleUpdateEditingCode}
        onSaveEditedCode={handleSaveEditedCode}
        onCancelEditCode={handleCancelEditCode}
      />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        modelConfig={modelConfig}
        onConfigChange={handleConfigChange}
        onSaveSettings={handleSaveSettings}
        isBusy={isBusy}
        runAsAdmin={runAsAdmin}
        uiApiKey={uiApiKey}
        useUiApiKey={useUiApiKey}
        onApplyUiApiKey={handleApplyUiApiKey}
        onUseEnvKey={handleUseEnvKey} // SỬA Ở ĐÂY
        targetOs={targetOs}
        fileType={fileType}
        customFileName={customFileName}
        fortiGateConfig={fortiGateConfig}
        // Truyen state va handler cho cmd FGT context
        fortiGateContextCommandsConfig={{ // Gom nhom cho de nhin
          list: DEFAULT_FORTIGATE_CONTEXT_COMMANDS,
          selected: fortiGateContextCommands,
        }}
      />
    </div>
  );
}
export default App;