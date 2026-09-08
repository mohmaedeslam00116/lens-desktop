import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  Layers,
  FolderArchive,
  RefreshCw,
  Search,
  Check,
  X,
  FileCode,
  Shield,
  Tag
} from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../i18n/translations';

export type SkillScope = 'workspace' | 'user' | 'builtin';
export type SkillLifecycleState = 'installed' | 'enabled' | 'selected' | 'active' | 'incompatible';

export interface DetailedSkillItem {
  name: string;
  scope: SkillScope;
  rootPath: string;
  skillFilePath: string;
  frontmatter: {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, any>;
    allowedTools?: string[];
  };
  states: SkillLifecycleState[];
  isEnabled: boolean;
  isSelected?: boolean;
  isActive?: boolean;
  isIncompatible?: boolean;
  hasScripts: boolean;
  scriptFiles: string[];
  referenceFiles: string[];
  incompatibilityReason?: string;
}

export interface SkillPreInspectionResult {
  valid: boolean;
  name: string;
  description: string;
  author?: string;
  license?: string;
  compatibility?: string;
  allowedTools: string[];
  hasScripts: boolean;
  scriptFiles: string[];
  totalFiles: number;
  hasCollision: boolean;
  collidingScope?: SkillScope;
  error?: string;
}

interface SkillsManagerViewProps {
  language: Language;
  apiBase?: string;
  activeSkillNames?: string[];
  selectedSkillNames?: string[];
}

export const SkillsManagerView: React.FC<SkillsManagerViewProps> = ({
  language,
  apiBase = 'http://127.0.0.1:8000',
  activeSkillNames = [],
  selectedSkillNames = []
}) => {
  const isArabic = language === 'ar';
  const t = translations[language] || translations.en;

  const [skills, setSkills] = useState<DetailedSkillItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | SkillScope>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pre-Inspection Modal State
  const [isPreInspectOpen, setIsPreInspectOpen] = useState(false);
  const [inspectionData, setInspectionData] = useState<SkillPreInspectionResult | null>(null);
  const [stagedPayload, setStagedPayload] = useState<{ zipBase64?: string; files?: Array<{ path: string; content: string }> } | null>(null);
  const [collisionAction, setCollisionAction] = useState<'keep' | 'overwrite' | 'rename'>('overwrite');
  const [renameInput, setRenameInput] = useState('');
  const [targetScope, setTargetScope] = useState<'workspace' | 'user'>('workspace');
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSkills = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${apiBase}/api/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.skills)) {
        setSkills(data.skills);
      }
    } catch (err: any) {
      console.error('Failed to load skills:', err);
      setActionError(err.message || 'Failed to connect to skills service');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, [apiBase]);

  // Handle Enable/Disable Toggle
  const handleToggle = async (name: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`${apiBase}/api/skills/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, enabled: !currentEnabled })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setSkills((prev) =>
          prev.map((s) => {
            if (s.name.toLowerCase() === name.toLowerCase()) {
              const newEnabled = data.isEnabled;
              const newStates: SkillLifecycleState[] = ['installed'];
              if (newEnabled && !s.isIncompatible) newStates.push('enabled');
              if (s.isSelected) newStates.push('selected');
              if (s.isActive) newStates.push('active');
              if (s.isIncompatible) newStates.push('incompatible');
              return { ...s, isEnabled: newEnabled, states: newStates };
            }
            return s;
          })
        );
      }
    } catch (err: any) {
      setActionError(`Failed to toggle skill: ${err.message}`);
    }
  };

  // Handle Export .zip
  const handleExport = (name: string) => {
    const url = `${apiBase}/api/skills/export?name=${encodeURIComponent(name)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // File Upload / Drop handler
  const processUploadedFile = async (file: File) => {
    setActionError(null);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuf = e.target?.result as ArrayBuffer;
        if (!arrayBuf) return;
        const base64 = btoa(
          new Uint8Array(arrayBuf).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        // Pre-inspect in memory
        const inspectRes = await fetch(`${apiBase}/api/skills/inspect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zipBase64: base64, scope: targetScope })
        });

        if (!inspectRes.ok) throw new Error(`Inspection failed (HTTP ${inspectRes.status})`);
        const inspectData = await inspectRes.json();
        const result: SkillPreInspectionResult = inspectData.inspection;

        setInspectionData(result);
        setStagedPayload({ zipBase64: base64 });
        setRenameInput(result.hasCollision ? `${result.name}-custom` : '');
        setCollisionAction(result.hasCollision ? 'overwrite' : 'overwrite');
        setIsPreInspectOpen(true);
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setActionError(`Failed to read uploaded package: ${err.message}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      processUploadedFile(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFile(e.target.files[0]);
    }
  };

  // Confirm Import from Modal
  const handleConfirmImport = async () => {
    if (!stagedPayload || !inspectionData) return;
    setIsSubmittingImport(true);
    setActionError(null);

    try {
      const res = await fetch(`${apiBase}/api/skills/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stagedPayload,
          scope: targetScope,
          collisionAction,
          renameTo: collisionAction === 'rename' ? renameInput : undefined
        })
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      setIsPreInspectOpen(false);
      setStagedPayload(null);
      setInspectionData(null);
      await fetchSkills();
    } catch (err: any) {
      setActionError(`Import error: ${err.message}`);
    } finally {
      setIsSubmittingImport(false);
    }
  };

  // Filtering
  const filteredSkills = skills.filter((s) => {
    if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchName = s.name.toLowerCase().includes(q);
    const matchDesc = (s.frontmatter?.description || '').toLowerCase().includes(q);
    const matchAuthor = (s.frontmatter?.metadata?.author || '').toLowerCase().includes(q);
    const matchTools = (s.frontmatter?.allowedTools || []).some((t) => t.toLowerCase().includes(q));
    return matchName || matchDesc || matchAuthor || matchTools;
  });

  // Telemetry Counts
  const totalInstalled = skills.length;
  const totalEnabled = skills.filter((s) => s.isEnabled).length;
  const totalActive = skills.filter((s) => activeSkillNames.includes(s.name.toLowerCase())).length;
  const totalIncompatible = skills.filter((s) => s.isIncompatible).length;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-canvas text-ink p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Telemetry Bar */}
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-panel border border-line">
                <Sparkles className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-ink font-sans">
                  {t.skills_title || (isArabic ? 'مركز مهارات الوكيل الذكي' : 'Agent Skills Hub')}
                </h1>
                <p className="text-xs text-muted mt-0.5">
                  {t.skills_subtitle || (isArabic ? 'استكشف واستورد وأدر مهارات التحليل النمطية' : 'Discover, import, and manage modular analytical skills')}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept=".zip"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:opacity-90 transition cursor-pointer shadow-sm active:scale-95"
            >
              <Upload className="w-4 h-4" />
              <span>{t.skills_import_btn || (isArabic ? 'استيراد مهارة' : 'Import Skill')}</span>
            </button>
            <button
              type="button"
              onClick={fetchSkills}
              title={isArabic ? 'تحديث' : 'Refresh'}
              className="p-2 rounded-xl bg-panel border border-line text-secondary hover:text-ink hover:bg-surface transition"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Telemetry Header Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-panel border border-line space-y-1">
            <span className="text-[11px] text-muted font-sans">
              {t.skills_total_installed || (isArabic ? 'المهارات المثبتة' : 'Installed Skills')}
            </span>
            <p className="text-lg font-mono font-bold text-ink">{totalInstalled}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-panel border border-line space-y-1">
            <span className="text-[11px] text-muted font-sans">
              {t.skills_total_enabled || (isArabic ? 'المهارات المفعّلة' : 'Enabled Skills')}
            </span>
            <p className="text-lg font-mono font-bold text-accent">{totalEnabled}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-panel border border-line space-y-1">
            <span className="text-[11px] text-muted font-sans">
              {t.skills_total_active || (isArabic ? 'نشطة بالجلسة' : 'Active in Session')}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <p className="text-lg font-mono font-bold text-ink">{totalActive}</p>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-panel border border-line space-y-1">
            <span className="text-[11px] text-muted font-sans">
              {t.skills_total_incompatible || (isArabic ? 'غير متوافقة' : 'Incompatible')}
            </span>
            <p className="text-lg font-mono font-bold text-muted">{totalIncompatible}</p>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {actionError && (
        <div className="p-3 rounded-xl bg-panel border border-line text-xs text-ink flex items-center justify-between gap-2 border-s-4 border-s-accent">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="p-1 rounded text-muted hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Drag & Drop Import Zone */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 ${
          isDragging
            ? 'border-accent bg-surface/80 scale-[1.005]'
            : 'border-line hover:border-line-strong bg-panel/50 hover:bg-surface/30'
        }`}
      >
        <FolderArchive className={`w-8 h-8 ${isDragging ? 'text-accent' : 'text-muted'}`} />
        <p className="text-xs font-semibold text-ink">
          {isDragging
            ? (t.skills_drop_active || (isArabic ? 'أفلت حزمة المهارة لمعاينتها الأولية' : 'Drop skill package to pre-inspect'))
            : (t.skills_drop_hint || (isArabic ? 'اسحب وأفلت حزمة zip أو مجلداً هنا، أو انقر للتصفح' : 'Drag & drop a .zip archive here, or click to browse'))}
        </p>
        <p className="text-[11px] text-muted font-mono">
          {isArabic ? 'يدعم حزم SKILL.md والمراجع والموارد النمطية' : 'Supports standard portable SKILL.md packages & references'}
        </p>
      </section>

      {/* Controls & Search Bar */}
      <section className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.skills_search_placeholder || (isArabic ? 'بحث في المهارات...' : 'Search skills...')}
            className="w-full ps-9 pe-3 py-2 rounded-xl bg-panel border border-line text-xs text-ink placeholder:text-muted focus:outline-none focus:border-accent"
          />
        </div>

        {/* Scope Filter Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-panel border border-line text-xs font-medium self-stretch sm:self-auto overflow-x-auto">
          {(['all', 'workspace', 'user', 'builtin'] as const).map((sc) => {
            const labels: Record<string, string> = {
              all: t.skills_filter_all || (isArabic ? 'كافة النطاقات' : 'All Scopes'),
              workspace: t.skills_filter_workspace || (isArabic ? 'مساحة العمل' : 'Workspace'),
              user: t.skills_filter_user || (isArabic ? 'المستخدم العام' : 'Global User'),
              builtin: t.skills_filter_builtin || (isArabic ? 'المدمجة' : 'Built-in')
            };
            const isSelected = scopeFilter === sc;
            return (
              <button
                key={sc}
                type="button"
                onClick={() => setScopeFilter(sc)}
                className={`px-3 py-1 rounded-lg transition whitespace-nowrap cursor-pointer ${
                  isSelected
                    ? 'bg-surface text-ink font-semibold shadow-xs'
                    : 'text-muted hover:text-ink hover:bg-hover'
                }`}
              >
                {labels[sc]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Skills Cards Grid */}
      {filteredSkills.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-line rounded-2xl text-muted text-xs">
          <p>{t.skills_no_skills || (isArabic ? 'لم يتم العثور على مهارات مطابقة.' : 'No agent skills found matching criteria.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => {
            const normName = skill.name.toLowerCase();
            const isActive = activeSkillNames.includes(normName);
            const isSelected = selectedSkillNames.includes(normName);

            return (
              <article
                key={`${skill.scope}-${skill.name}`}
                className="flex flex-col justify-between p-4 rounded-2xl bg-panel border border-line hover:border-line-strong transition space-y-3 shadow-xs"
              >
                <div className="space-y-2.5">
                  {/* Top Row: Name, Scope & Toggle */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-sm font-bold text-ink truncate font-mono">
                          {skill.name}
                        </h2>
                        {skill.scope === 'builtin' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-line text-muted">
                            {isArabic ? 'مدمجة' : 'Builtin'}
                          </span>
                        )}
                        {skill.scope === 'workspace' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-line text-accent">
                            {isArabic ? 'مساحة العمل' : 'Workspace'}
                          </span>
                        )}
                        {skill.scope === 'user' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-line text-secondary">
                            {isArabic ? 'عام' : 'Global'}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-muted block truncate mt-0.5">
                        {skill.frontmatter?.metadata?.author ? `by ${skill.frontmatter.metadata.author}` : skill.rootPath}
                      </span>
                    </div>

                    {/* Enable/Disable Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggle(skill.name, skill.isEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        skill.isEnabled ? 'bg-primary' : 'bg-surface'
                      }`}
                      title={skill.isEnabled ? (isArabic ? 'تعطيل المهارة' : 'Disable Skill') : (isArabic ? 'تفعيل المهارة' : 'Enable Skill')}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-on-primary shadow-lg ring-0 transition duration-200 ease-in-out ${
                          skill.isEnabled ? (isArabic ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Canonical 5-State Badges */}
                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-surface border border-line text-muted">
                      {t.skills_state_installed || 'Installed'}
                    </span>
                    {skill.isEnabled && (
                      <span className="px-2 py-0.5 rounded bg-surface border border-line text-ink font-semibold">
                        {t.skills_state_enabled || 'Enabled'}
                      </span>
                    )}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded bg-surface border border-line text-accent font-semibold">
                        {t.skills_state_selected || 'Selected'}
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-line text-ink font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                        {t.skills_state_active || 'Active'}
                      </span>
                    )}
                    {skill.isIncompatible && (
                      <span className="px-2 py-0.5 rounded bg-surface border border-line text-accent">
                        {t.skills_state_incompatible || 'Incompatible'}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-secondary line-clamp-3 leading-relaxed">
                    {skill.frontmatter?.description || (isArabic ? 'لا يوجد وصف متاح.' : 'No description provided.')}
                  </p>

                  {/* Allowed Tools Pills */}
                  {skill.frontmatter?.allowedTools && skill.frontmatter.allowedTools.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-muted uppercase block">
                        {isArabic ? 'الأدوات المرتبطة' : 'Allowed Tools'}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {skill.frontmatter.allowedTools.map((tool) => (
                          <span
                            key={tool}
                            className="px-1.5 py-0.5 rounded bg-canvas border border-line text-[10px] font-mono text-secondary"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Executable Scripts Indicator */}
                  {skill.hasScripts && (
                    <div className="p-2 rounded-lg bg-surface border border-line text-[11px] text-muted flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-secondary shrink-0" />
                      <span className="truncate">
                        {isArabic ? `${skill.scriptFiles.length} ملفات سكربت برمجية` : `${skill.scriptFiles.length} executable script(s)`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="pt-3 border-t border-line/60 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1 text-[11px] text-muted font-mono">
                    {skill.frontmatter?.license && (
                      <span>{skill.frontmatter.license}</span>
                    )}
                    {skill.referenceFiles.length > 0 && (
                      <span>• {skill.referenceFiles.length} refs</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleExport(skill.name)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface hover:bg-hover text-ink font-mono text-[11px] border border-line transition cursor-pointer active:scale-95"
                    title={t.skills_export_zip || (isArabic ? 'تصدير zip' : 'Export .zip')}
                  >
                    <Download className="w-3 h-3 text-secondary" />
                    <span>{t.skills_export_zip || 'Export .zip'}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* In-Memory Pre-Inspection & Collision Resolution Modal */}
      {isPreInspectOpen && inspectionData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-fadeIn"
          role="dialog"
          aria-modal="true"
          dir={isArabic ? 'rtl' : 'ltr'}
        >
          <div className="w-full max-w-xl bg-canvas border border-line shadow-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <header className="px-5 py-4 border-b border-line bg-panel flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-accent" />
                <h2 className="text-sm font-bold text-ink">
                  {t.skills_preinspect_title || (isArabic ? 'المعاينة الأولية لحزمة المهارة' : 'Skill Package Pre-Inspection')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsPreInspectOpen(false)}
                className="p-1 rounded-lg text-muted hover:text-ink hover:bg-surface transition"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Metadata Card */}
              <div className="p-4 rounded-xl bg-panel border border-line space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold font-mono text-ink">{inspectionData.name}</h3>
                  {inspectionData.license && (
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-surface border border-line text-muted">
                      {inspectionData.license}
                    </span>
                  )}
                </div>
                <p className="text-xs text-secondary leading-relaxed">
                  {inspectionData.description}
                </p>
                {inspectionData.author && (
                  <p className="text-[11px] font-mono text-muted">
                    {isArabic ? `المؤلف: ${inspectionData.author}` : `Author: ${inspectionData.author}`}
                  </p>
                )}
              </div>

              {/* Tools Checklist */}
              {inspectionData.allowedTools.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-muted uppercase block">
                    {isArabic ? 'الأدوات المصرح بها' : 'Requested Tools'}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {inspectionData.allowedTools.map((tl) => (
                      <span key={tl} className="px-2 py-0.5 rounded bg-surface border border-line text-[11px] font-mono text-ink">
                        {tl}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Executable Script Security Callout */}
              {inspectionData.hasScripts && (
                <div className="p-3.5 rounded-xl bg-panel border border-line text-ink space-y-1 border-s-4 border-s-accent">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-accent">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{t.skills_script_warning_title || (isArabic ? 'تحذير: يحتوي ملفات برمجية تنفيذية' : 'Executable Script Warning')}</span>
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    {isArabic
                      ? `تحتوي هذه الحزمة على ${inspectionData.scriptFiles.length} ملفات برمجية (${inspectionData.scriptFiles.join(', ')}). تأكد من موثوقية المصدر.`
                      : `This package contains ${inspectionData.scriptFiles.length} executable script(s) (${inspectionData.scriptFiles.join(', ')}). Ensure you trust the author.`}
                  </p>
                </div>
              )}

              {/* Destination Scope Selection */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-mono text-muted uppercase block">
                  {t.skills_target_scope || (isArabic ? 'نطاق التثبيت المستهدف' : 'Target Scope')}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetScope('workspace')}
                    className={`p-2.5 rounded-xl border text-start transition cursor-pointer ${
                      targetScope === 'workspace'
                        ? 'border-accent bg-surface text-ink font-semibold'
                        : 'border-line bg-panel text-muted hover:text-ink'
                    }`}
                  >
                    <p className="font-semibold">{t.skills_filter_workspace || (isArabic ? 'مساحة العمل' : 'Workspace')}</p>
                    <p className="text-[10px] text-muted mt-0.5 font-mono">.agents/skills/{inspectionData.name}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetScope('user')}
                    className={`p-2.5 rounded-xl border text-start transition cursor-pointer ${
                      targetScope === 'user'
                        ? 'border-accent bg-surface text-ink font-semibold'
                        : 'border-line bg-panel text-muted hover:text-ink'
                    }`}
                  >
                    <p className="font-semibold">{t.skills_filter_user || (isArabic ? 'المستخدم العام' : 'Global User')}</p>
                    <p className="text-[10px] text-muted mt-0.5 font-mono">APPDATA/LENS/skills</p>
                  </button>
                </div>
              </div>

              {/* Collision Resolver Options */}
              {inspectionData.hasCollision && (
                <div className="p-3.5 rounded-xl bg-panel border border-line space-y-2.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-ink">
                    <Shield className="w-4 h-4 text-accent" />
                    <span>{t.skills_collision_detected || (isArabic ? 'تم رصد تعارض في اسم المهارة' : 'Naming Collision Detected')}</span>
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    {isArabic
                      ? `توجد مهارة بالاسم "${inspectionData.name}" بالفعل في نطاق ${inspectionData.collidingScope || 'الحالي'}. اختر كيفية المعالجة:`
                      : `A skill named "${inspectionData.name}" already exists in ${inspectionData.collidingScope || 'current'} scope. Select resolution:`}
                  </p>

                  <div className="space-y-1.5 pt-1">
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-line cursor-pointer">
                      <input
                        type="radio"
                        name="collision"
                        checked={collisionAction === 'overwrite'}
                        onChange={() => setCollisionAction('overwrite')}
                        className="text-primary focus:ring-accent"
                      />
                      <span className="font-medium text-ink">
                        {t.skills_action_overwrite || (isArabic ? 'استبدال مع نسخة احتياطية (حفظ .backup)' : 'Overwrite with Backup')}
                      </span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-line cursor-pointer">
                      <input
                        type="radio"
                        name="collision"
                        checked={collisionAction === 'rename'}
                        onChange={() => setCollisionAction('rename')}
                        className="text-primary focus:ring-accent"
                      />
                      <span className="font-medium text-ink">
                        {t.skills_action_rename || (isArabic ? 'إعادة التسمية عند الاستيراد' : 'Rename on Import')}
                      </span>
                    </label>

                    {collisionAction === 'rename' && (
                      <input
                        type="text"
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        placeholder={t.skills_rename_placeholder || (isArabic ? 'أدخل اسم المهارة الجديد...' : 'Enter new skill name...')}
                        className="w-full px-3 py-1.5 rounded-lg bg-canvas border border-line text-xs font-mono text-ink focus:outline-none focus:border-accent"
                      />
                    )}

                    <label className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-line cursor-pointer">
                      <input
                        type="radio"
                        name="collision"
                        checked={collisionAction === 'keep'}
                        onChange={() => setCollisionAction('keep')}
                        className="text-primary focus:ring-accent"
                      />
                      <span className="font-medium text-muted">
                        {t.skills_action_keep || (isArabic ? 'الإبقاء على الحالية (إلغاء الاستيراد)' : 'Keep Existing (Abort)')}
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <footer className="px-5 py-3.5 border-t border-line bg-panel flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsPreInspectOpen(false)}
                className="px-3.5 py-1.5 rounded-xl bg-surface hover:bg-hover text-secondary hover:text-ink text-xs font-medium border border-line transition cursor-pointer"
              >
                {t.skills_cancel || (isArabic ? 'إلغاء' : 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={isSubmittingImport}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:opacity-90 transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isSubmittingImport ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>{t.skills_confirm_import || (isArabic ? 'تأكيد وتثبيت المهارة' : 'Confirm & Install')}</span>
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
