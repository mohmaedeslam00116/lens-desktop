import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FileCode, 
  Terminal, 
  Shield, 
  Check, 
  X, 
  ArrowLeft, 
  ArrowRight, 
  Undo2, 
  Search, 
  BookOpen, 
  GitBranch, 
  AlertTriangle, 
  Play, 
  Layers, 
  ExternalLink,
  ChevronRight,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { Language } from '../../types';

interface WorkstationPrototypeProps {
  language: Language;
  onClose?: () => void;
}

type VariantKey = 'A' | 'B' | 'C';

export function WorkstationPrototypeView({ language, onClose }: WorkstationPrototypeProps) {
  const isAr = language === 'ar';
  
  // URL search param or local state switcher
  const [variant, setVariant] = useState<VariantKey>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const v = urlParams.get('variant');
      if (v === 'A' || v === 'B' || v === 'C') return v;
    } catch { /* ignore */ }
    return 'A';
  });

  // Interactive Mock State
  const [selectedFile, setSelectedFile] = useState<string>('src/cache/redis.ts');
  const [activeDiffMode, setActiveDiffMode] = useState<boolean>(true);
  const [changeSetStatus, setChangeSetStatus] = useState<'pending' | 'applied' | 'reverted'>('pending');
  const [selectedClaimId, setSelectedClaimId] = useState<string>('claim-1');
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(true);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[sandbox] Sanitized execution environment initialized.',
    '[sandbox] Stripped 14 sensitive tokens (OPENAI_KEY, ANTHROPIC_KEY, SSH_AUTH_SOCK).',
    '[policy] Active capability grant: READ_ONLY_INSPECTION (Phase 1).',
    '[task] Ready for developer instructions.'
  ]);

  // Sync variant to URL search param
  const handleVariantChange = (newVariant: VariantKey) => {
    setVariant(newVariant);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', newVariant);
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
  };

  // Keyboard navigation for switcher
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return;
      if (e.key === 'ArrowLeft') {
        if (variant === 'A') handleVariantChange('C');
        else if (variant === 'B') handleVariantChange('A');
        else if (variant === 'C') handleVariantChange('B');
      } else if (e.key === 'ArrowRight') {
        if (variant === 'A') handleVariantChange('B');
        else if (variant === 'B') handleVariantChange('C');
        else if (variant === 'C') handleVariantChange('A');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [variant]);

  // Mock Data
  const mockFiles = [
    { path: 'src/cache/redis.ts', status: 'modified', additions: 18, deletions: 4 },
    { path: 'src/cache/types.ts', status: 'modified', additions: 7, deletions: 1 },
    { path: 'test/cache.test.ts', status: 'added', additions: 34, deletions: 0 },
    { path: 'package.json', status: 'unchanged', additions: 0, deletions: 0 },
    { path: '.agents/skills/academic.md', status: 'unchanged', additions: 0, deletions: 0 }
  ];

  const mockEvidence = [
    {
      id: 'claim-1',
      title: 'Redis v7.2 Cluster Connection Protocol',
      sourceUrl: 'https://redis.io/docs/latest/develop/connect/clients/',
      hash: 'sha256-e3b0c442...',
      excerpt: 'Use cluster.nodes() with auto-reconnect backoff factor 1.5. Avoid synchronous reconnect loops on connection failure.'
    },
    {
      id: 'claim-2',
      title: 'ioredis Connection Pool Best Practices',
      sourceUrl: 'https://github.com/redis/ioredis/issues/1429',
      hash: 'sha256-8a7c21f9...',
      excerpt: 'Ensure keepAlive option is enabled on socket configuration to prevent silent socket termination behind AWS NLB.'
    }
  ];

  const handleApplyChangeSet = () => {
    setChangeSetStatus('applied');
    setTerminalLogs(prev => [
      ...prev,
      `[transaction] Applied patch atomically across 3 files (commit hash #e5f6a7b).`,
      `[manifest] Rollback snapshot stored: .lens/transactions/tx-001.json`
    ]);
  };

  const handleUndoTransaction = () => {
    setChangeSetStatus('reverted');
    setTerminalLogs(prev => [
      ...prev,
      `[transaction] Reverted patch #e5f6a7b -> Restored base hash #a1b2c3d.`,
      `[manifest] Workspace fingerprint verified clean.`
    ]);
  };

  return (
    <div className={`fixed inset-0 z-50 bg-[#111111] text-[#E0E0E0] flex flex-col font-sans select-none ${isAr ? 'rtl' : 'ltr'}`}>
      {/* Top Navbar */}
      <header className="h-11 border-b border-[#262626] bg-[#161616] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold tracking-wider text-white">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            <span>LENS 2.0 WORKSTATION</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">PROTOTYPE</span>
          </div>
          <span className="text-[#555555]">|</span>
          <div className="flex items-center gap-1.5 text-[#888888]">
            <GitBranch className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-mono text-[11px] text-zinc-300">main</span>
            <span className="font-mono text-[10px] text-zinc-500">(#a1b2c3d)</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
            <Shield className="w-3 h-3" />
            <span>{isAr ? 'الصلاحية: قراءة فقط (المرحلة 1)' : 'Grant: Read-Only Policy (Phase 1)'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onClose && (
            <button 
              onClick={onClose}
              className="p-1 rounded hover:bg-[#262626] text-[#888888] hover:text-white transition-colors"
              title={isAr ? 'إغلاق النموذج' : 'Close Prototype'}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Workstation Body Based on Variant */}
      <div className="flex-1 overflow-hidden relative">
        {variant === 'A' && (
          <VariantAThreeColumn 
            isAr={isAr}
            files={mockFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            diffMode={activeDiffMode}
            onToggleDiffMode={() => setActiveDiffMode(!activeDiffMode)}
            changeSetStatus={changeSetStatus}
            onApply={handleApplyChangeSet}
            onUndo={handleUndoTransaction}
            evidence={mockEvidence}
            selectedClaimId={selectedClaimId}
            onSelectClaim={setSelectedClaimId}
            terminalLogs={terminalLogs}
            isTerminalOpen={isTerminalOpen}
            onToggleTerminal={() => setIsTerminalOpen(!isTerminalOpen)}
          />
        )}

        {variant === 'B' && (
          <VariantBDualDeck 
            isAr={isAr}
            files={mockFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            changeSetStatus={changeSetStatus}
            onApply={handleApplyChangeSet}
            onUndo={handleUndoTransaction}
            evidence={mockEvidence}
            selectedClaimId={selectedClaimId}
            onSelectClaim={setSelectedClaimId}
            terminalLogs={terminalLogs}
          />
        )}

        {variant === 'C' && (
          <VariantCMinimalist 
            isAr={isAr}
            files={mockFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            changeSetStatus={changeSetStatus}
            onApply={handleApplyChangeSet}
            onUndo={handleUndoTransaction}
            evidence={mockEvidence}
            terminalLogs={terminalLogs}
          />
        )}
      </div>

      {/* Floating Prototype Variant Switcher (Bottom Center) */}
      <footer className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1C1C1C] border border-[#333333] shadow-2xl backdrop-blur-md text-xs">
        <button 
          onClick={() => {
            if (variant === 'A') handleVariantChange('C');
            else if (variant === 'B') handleVariantChange('A');
            else if (variant === 'C') handleVariantChange('B');
          }}
          className="p-1 rounded-full hover:bg-[#2A2A2A] text-zinc-300 hover:text-white"
          title="Previous Variant (←)"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2 px-2 font-medium">
          <span className="text-blue-400 font-bold">Variant {variant}:</span>
          <span className="text-zinc-200">
            {variant === 'A' && (isAr ? 'محطة الـ IDE الثلاثية الكلاسيكية' : 'Classic 3-Column IDE')}
            {variant === 'B' && (isAr ? 'منصة العمل المزدوجة (بحث في الأعلى وكود بالأسفل)' : 'Dual-Deck Mission Control')}
            {variant === 'C' && (isAr ? 'المحرر المركّز مع لوحات جانبية عائمة' : 'Focused Canvas with Floating Drawers')}
          </span>
        </div>

        <button 
          onClick={() => {
            if (variant === 'A') handleVariantChange('B');
            else if (variant === 'B') handleVariantChange('C');
            else if (variant === 'C') handleVariantChange('A');
          }}
          className="p-1 rounded-full hover:bg-[#2A2A2A] text-zinc-300 hover:text-white"
          title="Next Variant (→)"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </footer>
    </div>
  );
}

// ==========================================
// VARIANT A: Classic 3-Column IDE Layout
// ==========================================
function VariantAThreeColumn({ 
  isAr, files, selectedFile, onSelectFile, diffMode, onToggleDiffMode,
  changeSetStatus, onApply, onUndo, evidence, selectedClaimId, onSelectClaim,
  terminalLogs, isTerminalOpen, onToggleTerminal
}: any) {
  return (
    <div className="h-full flex divide-x divide-[#262626]">
      {/* Col 1: File Explorer */}
      <div className="w-60 bg-[#141414] flex flex-col flex-shrink-0 text-xs">
        <div className="p-2.5 border-b border-[#262626] font-semibold text-zinc-400 flex items-center justify-between">
          <span>{isAr ? 'مستكشف المشروع' : 'WORKSPACE'}</span>
          <span className="text-[10px] text-zinc-500 font-mono">3 modified</span>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {files.map((file: any) => (
            <button
              key={file.path}
              onClick={() => onSelectFile(file.path)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors font-mono text-[11px] ${
                selectedFile === file.path ? 'bg-blue-500/10 text-blue-400 font-medium' : 'text-zinc-400 hover:bg-[#1A1A1A] hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <FileCode className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                <span className="truncate">{file.path}</span>
              </div>
              {file.status !== 'unchanged' && (
                <span className={`text-[10px] px-1 rounded ${file.status === 'added' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {file.status === 'added' ? 'A' : 'M'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Col 2: Monaco Editor / Diff Reviewer & Terminal */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#181818]">
        {/* Editor Tab Bar & Change Set Controls */}
        <div className="h-10 border-b border-[#262626] bg-[#141414] px-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="px-3 py-1 bg-[#1E1E1E] border-t-2 border-blue-500 text-white text-xs font-mono flex items-center gap-2">
              <span>{selectedFile}</span>
              <span className="text-[10px] text-amber-400 font-bold">•</span>
            </div>
            <button 
              onClick={onToggleDiffMode}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                diffMode ? 'bg-blue-600/20 text-blue-300 border-blue-500/40' : 'text-zinc-400 border-[#333333]'
              }`}
            >
              {diffMode ? (isAr ? 'عرض الفروق (Diff Active)' : 'Diff Review') : (isAr ? 'عرض الكود (Code)' : 'Code View')}
            </button>
          </div>

          {/* Atomic Change Set Action */}
          <div className="flex items-center gap-2">
            {changeSetStatus === 'pending' ? (
              <button 
                onClick={onApply}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isAr ? 'اعتماد التغييرات ذرياً' : 'Approve Change Set'}</span>
              </button>
            ) : changeSetStatus === 'applied' ? (
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-xs flex items-center gap-1 font-medium">
                  <Check className="w-3.5 h-3.5" /> {isAr ? 'تم تطبيق المعاملة' : 'Applied'}
                </span>
                <button 
                  onClick={onUndo}
                  className="px-2 py-1 bg-[#2A2A2A] hover:bg-[#333333] text-zinc-300 rounded text-xs font-mono flex items-center gap-1 border border-[#3E3E3E]"
                  title={isAr ? 'تراجع عن المعاملة' : 'Undo Transaction'}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تراجع' : 'Undo'}</span>
                </button>
              </div>
            ) : (
              <span className="text-zinc-400 text-xs italic">{isAr ? 'تم التراجع عن التعديل' : 'Reverted'}</span>
            )}
          </div>
        </div>

        {/* Mock Diff / Code View */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-[#181818]">
          <div className="text-zinc-500 mb-2 border-b border-[#262626] pb-1">
            @@ -12,4 +12,18 @@ import Redis from 'ioredis';
          </div>
          <div className="text-zinc-400">  export class DistributedCacheManager &#123;</div>
          <div className="text-zinc-400">    private client: Redis;</div>
          <div className="bg-rose-500/10 text-rose-300 border-l-2 border-rose-500 px-2 py-0.5">
            -   constructor() &#123; this.client = new Redis(); &#125;
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +   constructor(clusterNodes: string[]) &#123;
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +     // Verified via Redis v7.2 Evidence [claim-1]
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +     this.client = new Redis.Cluster(clusterNodes, &#123;
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +       scaleReads: 'slave',
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +       maxRedirections: 16
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +     &#125;);
          </div>
          <div className="bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5">
            +   &#125;
          </div>
          <div className="text-zinc-400">  &#125;</div>
        </div>

        {/* Collapsible Terminal Drawer */}
        <div className="border-t border-[#262626] bg-[#121212] flex flex-col">
          <div 
            onClick={onToggleTerminal}
            className="h-7 px-3 flex items-center justify-between cursor-pointer hover:bg-[#1A1A1A] text-zinc-400 text-[11px] font-mono select-none"
          >
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-blue-400" />
              <span>TERMINAL SANDBOX (Restricted PTY)</span>
            </div>
            <span>{isTerminalOpen ? '▼' : '▲'}</span>
          </div>
          {isTerminalOpen && (
            <div className="h-32 p-2.5 overflow-y-auto font-mono text-[11px] text-zinc-300 space-y-1 bg-[#0D0D0D]">
              {terminalLogs.map((log: string, idx: number) => (
                <div key={idx} className="leading-snug">
                  <span className="text-zinc-600 mr-2">$</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Col 3: Autonomous Agent Harness & Evidence Shelf */}
      <div className="w-80 bg-[#141414] flex flex-col flex-shrink-0 text-xs">
        <div className="p-2.5 border-b border-[#262626] font-semibold text-zinc-300 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-400" />
            <span>{isAr ? 'وكيل الأبحاث والتطوير' : 'RESEARCH AGENT HARNESS'}</span>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="p-2 border-b border-[#262626] flex gap-1">
          <button className="flex-1 py-1 rounded bg-blue-600 text-white font-medium text-center">
            {isAr ? 'كود (Code Act)' : 'Code Act'}
          </button>
          <button className="flex-1 py-1 rounded bg-[#202020] text-zinc-400 hover:text-white text-center">
            {isAr ? 'أبحاث (Research)' : 'Research'}
          </button>
        </div>

        {/* Evidence Shelf Section */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between text-zinc-400 font-semibold text-[11px]">
            <span>{isAr ? 'حزمة الأدلة المستخلصة (EvidenceBundle)' : 'IMMUTABLE EVIDENCE BUNDLE'}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
              UNTRUSTED
            </span>
          </div>

          {evidence.map((item: any) => (
            <div 
              key={item.id}
              onClick={() => onSelectClaim(item.id)}
              className={`p-2.5 rounded border transition-all cursor-pointer ${
                selectedClaimId === item.id ? 'bg-[#1C1C1C] border-blue-500/50' : 'bg-[#161616] border-[#262626] hover:border-[#333333]'
              }`}
            >
              <div className="font-medium text-zinc-200 text-xs mb-1 flex items-center justify-between">
                <span>{item.title}</span>
                <ExternalLink className="w-3 h-3 text-zinc-500" />
              </div>
              <p className="text-zinc-400 text-[11px] leading-relaxed mb-2 font-mono">
                "{item.excerpt}"
              </p>
              <div className="text-[10px] text-zinc-500 truncate font-mono">
                {item.sourceUrl}
              </div>
            </div>
          ))}
        </div>

        {/* Agent Prompt Input */}
        <div className="p-3 border-t border-[#262626] bg-[#161616]">
          <div className="relative">
            <input 
              type="text" 
              placeholder={isAr ? 'وجّه الوكيل (مثال: أضف اختبارات الوحدة)...' : 'Instruct agent (e.g. add unit tests)...'}
              className="w-full bg-[#0F0F0F] border border-[#2E2E2E] rounded px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
            <button className="absolute right-2 top-2 p-1 text-blue-400 hover:text-blue-300">
              <Play className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// VARIANT B: Dual-Deck Mission Control
// ==========================================
function VariantBDualDeck({ 
  isAr, files, selectedFile, onSelectFile, changeSetStatus, onApply, onUndo,
  evidence, terminalLogs 
}: any) {
  return (
    <div className="h-full flex flex-col divide-y divide-[#262626]">
      {/* Top Deck: Research & Evidence Exploration */}
      <div className="h-1/2 flex divide-x divide-[#262626] bg-[#141414]">
        {/* Upper Left: Research Stream & Queries */}
        <div className="w-1/2 p-4 overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-blue-400 font-bold text-xs">
              <Search className="w-4 h-4" />
              <span>{isAr ? 'مرحلة الأبحاث والاستقصاء التقني' : 'STAGE 1: DEEP TECHNICAL RESEARCH'}</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">100 sources audited</span>
          </div>

          <div className="space-y-2 flex-1">
            <div className="p-2.5 rounded bg-[#1A1A1A] border border-[#2B2B2B] text-xs">
              <div className="text-zinc-300 font-semibold mb-1">Architecture Decision: Redis Cluster Client Topology</div>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Evaluating failover dynamics between Sentinel and Cluster modes under Node.js runtime.
              </p>
            </div>
          </div>
        </div>

        {/* Upper Right: Immutable Evidence Claims */}
        <div className="w-1/2 p-4 overflow-y-auto bg-[#161616]">
          <div className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{isAr ? 'الأدلة المعتمدة (EvidenceBundle - غير موثوقة المصدر)' : 'VERIFIED CLAIMS (Untrusted External Handoff)'}</span>
          </div>
          <div className="space-y-2">
            {evidence.map((item: any) => (
              <div key={item.id} className="p-2 bg-[#1C1C1C] border border-[#2E2E2E] rounded text-xs">
                <div className="text-zinc-200 font-medium mb-0.5">{item.title}</div>
                <div className="font-mono text-[10px] text-zinc-400">"{item.excerpt}"</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Deck: Code Editor & Terminal Sandbox */}
      <div className="h-1/2 flex divide-x divide-[#262626] bg-[#181818]">
        {/* Lower Left: Code & Diff Editor */}
        <div className="w-1/2 flex flex-col p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <FileCode className="w-4 h-4" />
              <span>{isAr ? 'مرحلة تطبيق التعديلات الذرية' : 'STAGE 2: ATOMIC PATCH APPLICATION'}</span>
            </div>
            {changeSetStatus === 'pending' ? (
              <button 
                onClick={onApply}
                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium"
              >
                {isAr ? 'تطبيق الـ Patch' : 'Apply Patch'}
              </button>
            ) : (
              <button onClick={onUndo} className="px-2 py-0.5 bg-[#2B2B2B] text-zinc-300 rounded text-xs font-mono">
                Undo
              </button>
            )}
          </div>
          <div className="flex-1 bg-[#121212] p-3 rounded font-mono text-[11px] overflow-auto text-zinc-300 border border-[#282828]">
            <div className="text-emerald-400">+ class DistributedCacheManager &#123; ... &#125;</div>
            <div className="text-zinc-500">// Ready for automated verification</div>
          </div>
        </div>

        {/* Lower Right: Terminal Output */}
        <div className="w-1/2 flex flex-col p-4 bg-[#111111]">
          <div className="text-xs font-bold text-zinc-400 mb-2 flex items-center gap-1.5 font-mono">
            <Terminal className="w-4 h-4 text-blue-400" />
            <span>SANDBOXED PROCESS EXECUTION (Child Process Tree)</span>
          </div>
          <div className="flex-1 bg-[#0A0A0A] p-3 rounded font-mono text-[11px] text-zinc-300 overflow-auto border border-[#222222] space-y-1">
            {terminalLogs.map((log: string, idx: number) => (
              <div key={idx}><span className="text-zinc-600 mr-2">&gt;</span>{log}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// VARIANT C: Minimalist Full-Width Workstation
// ==========================================
function VariantCMinimalist({ 
  isAr, files, selectedFile, onSelectFile, changeSetStatus, onApply, onUndo, evidence, terminalLogs 
}: any) {
  const [drawerOpen, setDrawerOpen] = useState<'files' | 'agent' | null>(null);

  return (
    <div className="h-full relative flex flex-col bg-[#141414]">
      {/* Top Breadcrumb Bar */}
      <div className="h-9 border-b border-[#242424] px-4 flex items-center justify-between text-xs font-mono text-zinc-400 bg-[#161616]">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setDrawerOpen(drawerOpen === 'files' ? null : 'files')}
            className="px-2 py-1 rounded bg-[#202020] text-zinc-300 hover:text-white flex items-center gap-1.5"
          >
            <Folder className="w-3.5 h-3.5" />
            <span>{isAr ? 'الملفات' : 'Files'}</span>
          </button>
          <span>/</span>
          <span className="text-white font-medium">{selectedFile}</span>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setDrawerOpen(drawerOpen === 'agent' ? null : 'agent')}
            className="px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 flex items-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{isAr ? 'الوكيل الذكي' : 'Agent Copilot'}</span>
          </button>
        </div>
      </div>

      {/* Main Full-Width Monaco Editor Surface */}
      <div className="flex-1 p-6 font-mono text-xs overflow-auto leading-relaxed bg-[#181818] text-zinc-300">
        <div className="max-w-4xl mx-auto space-y-1">
          <div className="text-zinc-500">// LENS 2.0 Distraction-Free Developer Canvas</div>
          <div className="text-blue-400">import &#123; Redis &#125; from 'ioredis';</div>
          <div className="text-zinc-300">export async function initializeCacheNode() &#123;</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-3 py-1 rounded border-l-2 border-emerald-500 my-2">
            +   // Verified excerpt from Redis cluster documentation [claim-1]
            <br />+   const client = new Redis.Cluster(['localhost:7000', 'localhost:7001']);
            <br />+   await client.ping();
          </div>
          <div className="text-zinc-300">&#125;</div>
        </div>
      </div>

      {/* Floating Side Drawer: Files */}
      {drawerOpen === 'files' && (
        <div className="absolute top-9 left-0 bottom-0 w-64 bg-[#161616] border-r border-[#2C2C2C] shadow-2xl p-3 z-30 flex flex-col text-xs font-mono">
          <div className="flex items-center justify-between pb-2 border-b border-[#2C2C2C] mb-2 font-bold text-zinc-300">
            <span>FILES</span>
            <button onClick={() => setDrawerOpen(null)}><X className="w-4 h-4" /></button>
          </div>
          {files.map((file: any) => (
            <div 
              key={file.path} 
              onClick={() => { onSelectFile(file.path); setDrawerOpen(null); }}
              className="p-1.5 rounded hover:bg-[#202020] cursor-pointer text-zinc-400 hover:text-white"
            >
              {file.path}
            </div>
          ))}
        </div>
      )}

      {/* Floating Side Drawer: Agent & Evidence */}
      {drawerOpen === 'agent' && (
        <div className="absolute top-9 right-0 bottom-0 w-80 bg-[#161616] border-l border-[#2C2C2C] shadow-2xl p-4 z-30 flex flex-col text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-[#2C2C2C] mb-3 font-bold text-zinc-200">
            <span>RESEARCH COPILOT</span>
            <button onClick={() => setDrawerOpen(null)}><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            <div className="text-[10px] text-amber-400 font-bold uppercase">Evidence Claims</div>
            {evidence.map((item: any) => (
              <div key={item.id} className="p-2 rounded bg-[#202020] text-zinc-300 font-mono text-[11px]">
                "{item.excerpt}"
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-[#262626]">
            {changeSetStatus === 'pending' ? (
              <button onClick={onApply} className="w-full py-2 bg-emerald-600 text-white rounded font-medium">
                Approve Patch
              </button>
            ) : (
              <button onClick={onUndo} className="w-full py-2 bg-[#2B2B2B] text-zinc-300 rounded font-mono">
                Undo Transaction
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
