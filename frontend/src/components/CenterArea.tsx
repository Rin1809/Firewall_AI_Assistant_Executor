// frontend/src/components/CenterArea.tsx
import React, { useRef, useEffect } from 'react';
import { FiSettings, FiChevronUp, FiEdit, FiSave } from 'react-icons/fi';
import UserInput from './UserInput';
import InteractionBlock from './InteractionBlock';
import CollapsedInteractionBlock from './CollapsedInteractionBlock';
import { ConversationBlock, ExecutionResult, TargetOS } from '../App';
import './CenterArea.css';

interface CenterAreaProps {
  conversation: Array<ConversationBlock>;
  isLoading: boolean;
  isBusy: boolean;
  prompt: string;
  setPrompt: (value: string) => void;
  onPrimarySubmit: (prompt: string) => void;
  onReview: (codeToReview: string, blockId: string) => void;
  onExecute: (codeToExecute: string, blockId: string) => void;
  onDebug: (codeToDebug: string, executionResult: ExecutionResult, blockId: string) => void;
  onApplyCorrectedCode: (code: string, originalDebugBlockId: string) => void;
  onInstallPackage: (packageName: string, originalDebugBlockId: string) => Promise<void>;
  onExplain: (blockId: string, contentToExplain: any, context: string) => void;
  collapsedStates: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
  expandedOutputs: Record<string, { stdout: boolean; stderr: boolean }>;
  onToggleOutputExpand: (blockId: string, type: 'stdout' | 'stderr') => void;
  onToggleSidebar: () => void;
  targetOs: TargetOS;
  isFortiGateInteractiveMode: boolean;
  onToggleFortiGateInteractiveMode: () => void;

  editingBlockId: string | null;
  currentEditingCode: string | null;
  onToggleEditCode: (blockId: string, currentCodeInBlock: string) => void;
  onUpdateEditingCode: (newCode: string) => void;
  onSaveEditedCode: (blockId: string) => void;
  onCancelEditCode: () => void;
}

const CenterArea: React.FC<CenterAreaProps> = (props) => {
  const {
    conversation, isLoading, isBusy, prompt, setPrompt,
    onPrimarySubmit, onReview, onExecute, onDebug, onApplyCorrectedCode,
    onInstallPackage, onExplain, collapsedStates, onToggleCollapse,
    expandedOutputs, onToggleOutputExpand, onToggleSidebar, targetOs,
    isFortiGateInteractiveMode, onToggleFortiGateInteractiveMode,
    editingBlockId, currentEditingCode, onToggleEditCode,
    onUpdateEditingCode, onSaveEditedCode, onCancelEditCode
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null); // Tham chieu den phan tu cuoi cung

  useEffect(() => {
    if (endOfMessagesRef.current) {
      const lastBlock = conversation.length > 0 ? conversation[conversation.length - 1] : null;
      // Cuon xuong neu block cuoi cung la moi HOAC block loading HOAC block suy nghi
      if (
        (lastBlock && lastBlock.isNew) ||
        conversation.some(b => b.type === 'loading' || b.type === 'ai_thinking_process')
      ) {
        // Delay ngan de cho DOM cap nhat kich thuoc sau khi them block moi
        const timer = setTimeout(() => {
          endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100); // Delay ngan hon
        return () => clearTimeout(timer);
      }
    }
  }, [conversation]); // Chay lai khi conversation thay doi


  const renderConversation = () => {
    const rounds: { userBlock: ConversationBlock; childrenBlocks: ConversationBlock[] }[] = [];
    let currentUserBlock: ConversationBlock | null = null;
    let currentRoundBlocks: ConversationBlock[] = [];

    for (const block of conversation) {
        // Block 'ai_thinking_process' se duoc xem nhu la con cua user prompt gan nhat
        // Hoac neu khong co user prompt, no se la con cua placeholder
        if (block.type === 'user') {
            if (currentUserBlock) rounds.push({ userBlock: currentUserBlock, childrenBlocks: currentRoundBlocks });
            currentUserBlock = block; currentRoundBlocks = [];
        } else if (currentUserBlock) {
            currentRoundBlocks.push(block);
        } else {
            // Neu block dau tien khong phai user (VD: loi global, hoac suy nghi ko co user prompt truoc)
            rounds.push({ userBlock: { type: 'placeholder', data: null, id: `ph-${block.id}`, timestamp: block.timestamp, isNew: block.isNew, thoughts: [] }, childrenBlocks: [block] });
        }
    }
    if (currentUserBlock) rounds.push({ userBlock: currentUserBlock, childrenBlocks: currentRoundBlocks });

    return rounds.map((round, index) => {
        const userBlockId = round.userBlock.id;
        const isPlaceholder = round.userBlock.type === 'placeholder';
        const isLastRound = index === rounds.length - 1;
        const isCollapsed = !isLastRound && !isPlaceholder && (collapsedStates[userBlockId] !== false); // Mac dinh la collapsed neu ko phai round cuoi

        if (isPlaceholder) { // Hien thi cac block con cua placeholder (neu co)
             return ( <div key={userBlockId} className="interaction-round placeholder-round">
                      {round.childrenBlocks.map(childBlock => (
                         <InteractionBlock key={childBlock.id} block={childBlock} isBusy={isBusy}
                             onReview={onReview} onExecute={onExecute} onDebug={onDebug}
                             onApplyCorrectedCode={onApplyCorrectedCode} onInstallPackage={onInstallPackage}
                             onExplain={onExplain} expandedOutputs={expandedOutputs} onToggleOutputExpand={onToggleOutputExpand}
                             editingBlockId={editingBlockId} currentEditingCode={currentEditingCode}
                             onToggleEditCode={onToggleEditCode} onUpdateEditingCode={onUpdateEditingCode}
                             onSaveEditedCode={onSaveEditedCode} onCancelEditCode={onCancelEditCode}
                             data-block-id={childBlock.id}/>
                     ))} </div> );
         }

        return (
            <div key={userBlockId + '-round'} className={`interaction-round ${isCollapsed ? 'collapsed' : ''}`}>
                {isCollapsed ? (
                    <CollapsedInteractionBlock key={userBlockId + '-ch'} promptText={round.userBlock.data as string} blockId={userBlockId} timestamp={round.userBlock.timestamp} onToggleCollapse={onToggleCollapse}/>
                ) : (
                    <InteractionBlock key={userBlockId + '-eh'} block={round.userBlock} isBusy={isBusy} onReview={()=>{}} onExecute={()=>{}} onDebug={()=>{}} onApplyCorrectedCode={()=>{}} onInstallPackage={async ()=>{}} onExplain={()=>{}} expandedOutputs={expandedOutputs} onToggleOutputExpand={onToggleOutputExpand}
                                      editingBlockId={null} currentEditingCode={null} // User block ko co edit
                                      onToggleEditCode={() => {}} onUpdateEditingCode={() => {}}
                                      onSaveEditedCode={() => {}} onCancelEditCode={() => {}}
                                      data-block-id={round.userBlock.id}/>
                )}
                <div className={`collapsible-content ${isCollapsed ? '' : 'expanded'}`}>
                    {round.childrenBlocks.map(childBlock => (
                        <InteractionBlock key={childBlock.id} block={childBlock} isBusy={isBusy}
                            onReview={onReview} onExecute={onExecute} onDebug={onDebug}
                            onApplyCorrectedCode={onApplyCorrectedCode} onInstallPackage={onInstallPackage}
                            onExplain={onExplain} expandedOutputs={expandedOutputs} onToggleOutputExpand={onToggleOutputExpand}
                            editingBlockId={editingBlockId} currentEditingCode={currentEditingCode}
                            onToggleEditCode={onToggleEditCode} onUpdateEditingCode={onUpdateEditingCode}
                            onSaveEditedCode={onSaveEditedCode} onCancelEditCode={onCancelEditCode}
                            data-block-id={childBlock.id}/>
                    ))}
                    {!isLastRound && !isCollapsed && (
                        <div className="collapse-round-wrapper">
                            <button onClick={() => onToggleCollapse(userBlockId)} className="collapse-round-button"><FiChevronUp /> Thu gọn</button>
                        </div>
                    )}
                </div>
            </div>
        );
    });
  };

  return (
    <main className="center-area-wrapper">
      <div className="top-bar">
         <h2>Firewall AI Assistant</h2> {/* Ten app */}
         <button onClick={onToggleSidebar} className="icon-button subtle settings-trigger-button" title="Cài đặt" disabled={isBusy} aria-label="Mở cài đặt"><FiSettings /></button>
      </div>
      <div className="interaction-container" ref={scrollRef}>
        {renderConversation()}
        <div ref={endOfMessagesRef} style={{ height: '1px' }} /> {/* Phan tu de cuon toi */}
      </div>
      <UserInput
        prompt={prompt}
        setPrompt={setPrompt}
        onPrimarySubmit={() => onPrimarySubmit(prompt)}
        isLoading={isLoading}
        targetOs={targetOs}
        isFortiGateInteractiveMode={isFortiGateInteractiveMode}
        onToggleFortiGateInteractiveMode={onToggleFortiGateInteractiveMode}
      />
    </main>
  );
};
export default CenterArea;