import React, { useState, useEffect } from 'react';
import { 
  X, 
  Check, 
  RefreshCw, 
  Plus, 
  Trash2, 
  Compass, 
  Sparkles, 
  Layers, 
  ArrowRight, 
  ArrowLeft,
  Sliders,
  FileText
} from 'lucide-react';
import { Language, ResearchPlan, PlanMilestone, ResearchMode } from '../../types';
import { useDialogFocus } from '../../hooks/useDialogFocus';

interface PlanApprovalModalProps {
  isOpen: boolean;
  language: Language;
  plan: ResearchPlan;
  onApprove: (approvedPlan: ResearchPlan) => void;
  onRegenerate: (modifier?: string) => void;
  onDiscard: (reason?: string) => void;
  isRegenerating?: boolean;
  mode?: ResearchMode;
}

const AVAILABLE_SKILL_LABELS: Record<string, { en: string; ar: string; descEn: string; descAr: string }> = {
  'academic-paper-analysis': {
    en: 'Academic Literature & Citations',
    ar: 'تحليل الأوراق الأكاديمية والمراجع',
    descEn: 'Extracts scholarly findings, methodologies, and formal references.',
    descAr: 'استخلاص النتائج والمنهجيات العلمية والاستشهادات الموثقة.'
  },
  'empirical-data-extraction': {
    en: 'Empirical Data & Quantitative Metrics',
    ar: 'استخراج البيانات الكمية والإحصائية',
    descEn: 'Focuses on statistics, benchmarks, percentages, and empirical measurements.',
    descAr: 'التركيز على الإحصاءات والنسب المئوية والقياسات التجريبية.'
  },
  'comparative-synthesis': {
    en: 'Comparative Synthesis & Trade-offs',
    ar: 'المقارنة المعيارية وتحليل المفاضلات',
    descEn: 'Builds side-by-side matrices comparing approaches and trade-offs.',
    descAr: 'بناء جداول مقارنة منهجية وتحليل المفاضلات التقنية.'
  },
  'bilingual-cross-lingual-bridge': {
    en: 'Bilingual Terminology Bridge',
    ar: 'جسر المصطلحات ثنائي اللغة',
    descEn: 'Expands Arabic technical queries into English equivalents for maximum recall.',
    descAr: 'توسيع المصطلحات بين العربية والإنجليزية لتعزيز دقة الاسترجاع.'
  },
  'web-retrieval-curator': {
    en: 'High-Credibility Web Curator',
    ar: 'انتقاء مصادر الويب الموثوقة',
    descEn: 'Filters low-signal domains and prioritizes primary documentation.',
    descAr: 'استبعاد المصادر السطحية والتركيز على الوثائق والمصادر الأولية.'
  }
};

export const PlanApprovalModal: React.FC<PlanApprovalModalProps> = ({
  isOpen,
  language,
  plan,
  onApprove,
  onRegenerate,
  onDiscard,
  isRegenerating = false,
  mode = 'standard',
}) => {
  const isArabic = language === 'ar';
  const isWide = mode === 'wide';
  const dialogRef = useDialogFocus(isOpen, () => onDiscard('User dismissed modal'));

  const [milestones, setMilestones] = useState<PlanMilestone[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [targetSources, setTargetSources] = useState<number>(100);
  const [maxHops, setMaxHops] = useState<number>(2);

  // New milestone draft inputs
  const [newQuery, setNewQuery] = useState('');
  const [newRationale, setNewRationale] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Regeneration feedback input
  const [modifierText, setModifierText] = useState('');
  const [showRegenerateInput, setShowRegenerateInput] = useState(false);

  // Sync state whenever plan changes
  useEffect(() => {
    if (plan) {
      setMilestones(plan.milestones ? [...plan.milestones] : []);
      setSelectedSkills(plan.suggestedSkills ? [...plan.suggestedSkills] : []);
      setTargetSources(plan.estimatedScope?.targetSources || 100);
      setMaxHops(plan.estimatedScope?.maxHops !== undefined ? plan.estimatedScope.maxHops : 2);
    }
  }, [plan]);

  if (!isOpen || !plan) return null;

  const handleUpdateMilestone = (id: string, field: 'query' | 'rationale', value: string) => {
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleRemoveMilestone = (id: string) => {
    if (milestones.length <= 1) return; // Maintain at least 1 milestone
    setMilestones(prev => prev.filter(m => m.id !== id));
  };

  const handleAddMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuery.trim()) return;

    const newMilestone: PlanMilestone = {
      id: `m-custom-${Date.now()}`,
      query: newQuery.trim(),
      rationale: newRationale.trim() || (isArabic ? 'محور بحثي مخصص أضافه المستخدم' : 'User-specified research milestone'),
      status: 'pending'
    };

    setMilestones(prev => [...prev, newMilestone]);
    setNewQuery('');
    setNewRationale('');
    setShowAddForm(false);
  };

  const handleToggleSkill = (skillId: string) => {
    setSelectedSkills(prev => 
      prev.includes(skillId) ? prev.filter(s => s !== skillId) : [...prev, skillId]
    );
  };

  const handleApproveAndStart = () => {
    const finalPlan: ResearchPlan = {
      ...plan,
      milestones,
      suggestedSkills: selectedSkills,
      estimatedScope: {
        targetSources,
        maxHops
      },
      status: 'approved',
      updatedAt: Date.now()
    };
    onApprove(finalPlan);
  };

  const ArrowIcon = isArabic ? ArrowLeft : ArrowRight;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in" role="presentation">
      <div 
        ref={dialogRef}
        className="bg-[#191919] border border-[#303030] text-[#EDEDEB] rounded-[12px] shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-approval-title"
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#303030] bg-[#141414]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#222222] border border-[#383838] flex items-center justify-center text-[#EDEDEB]">
              <Compass size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="plan-approval-title" className="text-base font-semibold text-[#EDEDEB]">
                  {isArabic ? 'صياغة واعتماد خطة البحث الاستقصائي' : 'Research Plan Scoping & Approval'}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded bg-[#242424] text-[#A0A0A0] border border-[#333333] font-mono">
                  v{plan.version}
                </span>
              </div>
              <p className="text-xs text-[#8E8E8E] mt-0.5">
                {isArabic 
                  ? (isWide ? 'تبدأ ميزانية الاسترجاع في البحث الموسع عند 100 وقد ترتفع تلقائيًا إلى 200 فقط عند بقاء فجوات أدلة؛ لا تمثل هذه الأرقام عدد المصادر المضمون.' : 'راجع المحاور المقترحة وخصص مسار البحث قبل بدء عملية الاسترجاع.')
                  : (isWide ? 'Wide Research begins with a retrieval budget of 100 and can rise to 200 only when evidence gaps remain; these are not guaranteed source counts.' : 'Review proposed milestones and authorize the retrieval trajectory.')}
              </p>
            </div>
          </div>
          <button
            onClick={() => onDiscard('User clicked close')}
            className="p-1.5 rounded text-[#8E8E8E] hover:text-[#EDEDEB] hover:bg-[#242424] transition-colors"
            aria-label={isArabic ? 'إلغاء وإغلاق' : 'Discard and close'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm">
          {/* Objective summary */}
          <div className="p-3.5 rounded-lg bg-[#111111] border border-[#2B2B2B]">
            <div className="text-xs font-medium text-[#8E8E8E] mb-1 flex items-center gap-1.5">
              <FileText size={13} />
              <span>{isArabic ? 'الهدف الاستقصائي الأساسي' : 'Primary Research Objective'}</span>
            </div>
            <p className="text-[#EDEDEB] font-medium leading-relaxed">{plan.objective}</p>
          </div>

          {/* Milestones Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-[#A0A0A0]" />
                <h3 className="text-sm font-semibold text-[#EDEDEB]">
                  {isArabic ? `المحاور والاستعلامات البحثية (${milestones.length})` : `Research Milestones & Subqueries (${milestones.length})`}
                </h3>
              </div>
              {!showAddForm && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="text-xs flex items-center gap-1 text-[#A0A0A0] hover:text-[#EDEDEB] bg-[#222222] hover:bg-[#2A2A2A] border border-[#333333] px-2.5 py-1 rounded transition-colors"
                >
                  <Plus size={13} />
                  <span>{isArabic ? 'إضافة محور' : 'Add Milestone'}</span>
                </button>
              )}
            </div>

            <div className="space-y-3">
              {milestones.map((m, index) => (
                <div 
                  key={m.id} 
                  className="p-3.5 rounded-lg bg-[#141414] border border-[#2B2B2B] hover:border-[#383838] transition-colors flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded bg-[#202020] border border-[#303030] text-[#A0A0A0] text-xs font-mono flex items-center justify-center font-bold">
                      {index + 1}
                    </span>
                    <div className="flex-1 space-y-1.5">
                      <input
                        type="text"
                        value={m.query}
                        onChange={(e) => handleUpdateMilestone(m.id, 'query', e.target.value)}
                        className="w-full bg-[#111111] border border-[#303030] rounded px-3 py-1.5 text-sm text-[#EDEDEB] focus:outline-none focus:border-[#555555]"
                        placeholder={isArabic ? 'صيغة الاستعلام البحثي...' : 'Subquery formulation...'}
                      />
                      <input
                        type="text"
                        value={m.rationale}
                        onChange={(e) => handleUpdateMilestone(m.id, 'rationale', e.target.value)}
                        className="w-full bg-transparent border-0 text-xs text-[#8E8E8E] focus:text-[#EDEDEB] focus:outline-none px-1"
                        placeholder={isArabic ? 'الغاية والمبرر من هذا المحور...' : 'Rationale and objective of this milestone...'}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={milestones.length <= 1}
                      onClick={() => handleRemoveMilestone(m.id)}
                      className={`p-1.5 rounded transition-colors ${
                        milestones.length <= 1 
                          ? 'text-[#444444] cursor-not-allowed' 
                          : 'text-[#8E8E8E] hover:text-[#EDEDEB] hover:bg-[#2A2A2A]'
                      }`}
                      aria-label={isArabic ? 'حذف المحور' : 'Remove milestone'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add Milestone Form */}
              {showAddForm && (
                <form onSubmit={handleAddMilestone} className="p-3.5 rounded-lg bg-[#171717] border border-[#3D3D3D] space-y-3">
                  <div className="text-xs font-semibold text-[#EDEDEB]">
                    {isArabic ? 'إضافة محور استقصائي جديد' : 'Add New Research Milestone'}
                  </div>
                  <input
                    type="text"
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    placeholder={isArabic ? 'أدخل الاستعلام أو المحور المطلوب...' : 'Enter milestone query...'}
                    className="w-full bg-[#111111] border border-[#333333] rounded px-3 py-1.5 text-sm text-[#EDEDEB] focus:outline-none focus:border-[#555555]"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={newRationale}
                    onChange={(e) => setNewRationale(e.target.value)}
                    placeholder={isArabic ? 'المبرر المنطقي (اختياري)...' : 'Rationale (optional)...'}
                    className="w-full bg-[#111111] border border-[#333333] rounded px-3 py-1.5 text-xs text-[#EDEDEB] focus:outline-none focus:border-[#555555]"
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-3 py-1 text-xs text-[#8E8E8E] hover:text-[#EDEDEB] bg-transparent rounded"
                    >
                      {isArabic ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      disabled={!newQuery.trim()}
                      className="px-3 py-1 text-xs font-medium bg-[#EDEDEB] text-[#111111] hover:bg-white disabled:opacity-50 rounded"
                    >
                      {isArabic ? 'إضافة المحور' : 'Add Milestone'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Suggested Skills Section */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles size={16} className="text-[#A0A0A0]" />
              <h3 className="text-sm font-semibold text-[#EDEDEB]">
                {isArabic ? 'المهارات الاستقصائية المقترحة' : 'Suggested Agent Skills'}
              </h3>
            </div>
            <p className="text-xs text-[#8E8E8E] mb-3">
              {isArabic 
                ? 'فعل أو عطل المهارات المتخصصة لتوجيه تركيز البحث' 
                : 'Toggle specialized analytical skills to focus retrieval and extraction'}
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(AVAILABLE_SKILL_LABELS).map(skillId => {
                const isSelected = selectedSkills.includes(skillId);
                const info = AVAILABLE_SKILL_LABELS[skillId];
                return (
                  <button
                    key={skillId}
                    type="button"
                    onClick={() => handleToggleSkill(skillId)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#EDEDEB] text-[#111111] border-[#EDEDEB] shadow-sm'
                        : 'bg-[#181818] text-[#8E8E8E] border-[#303030] hover:text-[#EDEDEB] hover:border-[#444444]'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-75" />
                    <span>{isArabic ? info.ar : info.en}</span>
                    {isSelected && <Check size={12} className="stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Estimated Scope & Budget Box */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] text-xs text-[#8E8E8E]">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-[#A0A0A0] font-medium">{isArabic ? (isWide ? 'ميزانية الاسترجاع المستهدفة:' : 'المصادر المستهدفة:') : (isWide ? 'Target retrieval budget:' : 'Target Sources:')} </span>
                <span className="text-[#EDEDEB] font-mono font-semibold">{targetSources}</span>
              </div>
              {isWide && <>
                <div className="w-px h-3 bg-[#333333]" />
                <div>
                  <span className="text-[#A0A0A0] font-medium">{isArabic ? 'ميزانية البداية / الحد الأقصى:' : 'Initial / maximum budget:'} </span>
                  <span className="text-[#EDEDEB] font-mono font-semibold">100 / 200</span>
                </div>
              </>}
              <div className="w-px h-3 bg-[#333333]" />
              <div>
                <span className="text-[#A0A0A0] font-medium">{isArabic ? 'أقصى جولات استقصاء:' : 'Max Hops:'} </span>
                <span className="text-[#EDEDEB] font-mono font-semibold">{maxHops}</span>
              </div>
            </div>
            <span className="text-[11px] text-[#6E6E6E]">
              {isWide ? (isArabic ? 'توسع تلقائي مشروط بفجوات الأدلة' : 'Automatic expansion only for evidence gaps') : (isArabic ? 'نطاق البحث المعتمد' : 'Authorized research scope')}
            </span>
          </div>

          {/* Regeneration Modifier Option */}
          {showRegenerateInput && (
            <div className="p-3.5 rounded-lg bg-[#171717] border border-[#3A3A3A] space-y-2">
              <div className="text-xs font-medium text-[#EDEDEB]">
                {isArabic ? 'توجيه إعادة الصياغة (اختياري)' : 'Regeneration Guidance (Optional)'}
              </div>
              <input
                type="text"
                value={modifierText}
                onChange={(e) => setModifierText(e.target.value)}
                placeholder={isArabic ? 'مثال: ركز أكثر على الجوانب الاقتصادية والتطبيقات العملية...' : 'E.g. Focus more on commercialization timelines and benchmarks...'}
                className="w-full bg-[#111111] border border-[#333333] rounded px-3 py-1.5 text-xs text-[#EDEDEB] focus:outline-none focus:border-[#555555]"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowRegenerateInput(false)}
                  className="px-2.5 py-1 text-xs text-[#8E8E8E] hover:text-[#EDEDEB]"
                >
                  {isArabic ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={isRegenerating}
                  onClick={() => {
                    onRegenerate(modifierText);
                    setShowRegenerateInput(false);
                  }}
                  className="px-3 py-1 text-xs font-medium bg-[#2B2B2B] hover:bg-[#383838] text-[#EDEDEB] rounded border border-[#444444]"
                >
                  {isRegenerating ? (isArabic ? 'جاري التوليد...' : 'Regenerating...') : (isArabic ? 'إعادة الصياغة الآن' : 'Regenerate Now')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#303030] bg-[#141414]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDiscard('User clicked discard')}
              className="px-3.5 py-2 text-xs font-medium text-[#8E8E8E] hover:text-[#EDEDEB] hover:bg-[#202020] rounded border border-transparent transition-colors"
            >
              {isArabic ? 'إلغاء' : 'Discard'}
            </button>
            <button
              type="button"
              disabled={isRegenerating}
              onClick={() => {
                onRegenerate(modifierText.trim() || undefined);
                setShowRegenerateInput(false);
              }}
              className="px-3.5 py-2 text-xs font-medium text-[#A0A0A0] hover:text-[#EDEDEB] bg-[#1E1E1E] hover:bg-[#262626] rounded border border-[#333333] transition-colors flex items-center gap-1.5"
            >
              <RefreshCw size={13} className={isRegenerating ? 'animate-spin' : ''} />
              <span>{isArabic ? 'إعادة صياغة الخطة' : 'Regenerate'}</span>
            </button>
            <button
              type="button"
              disabled={isRegenerating}
              onClick={() => setShowRegenerateInput(prev => !prev)}
              className={`p-2 text-xs rounded border transition-colors ${
                showRegenerateInput
                  ? 'bg-[#2A2A2A] text-[#EDEDEB] border-[#555555]'
                  : 'text-[#8E8E8E] hover:text-[#EDEDEB] border-transparent hover:bg-[#202020]'
              }`}
              title={isArabic ? 'إضافة توجيه لإعادة الصياغة' : 'Add guidance for regeneration'}
              aria-label={isArabic ? 'إضافة توجيه لإعادة الصياغة' : 'Add guidance for regeneration'}
            >
              <Sliders size={13} />
            </button>
          </div>

          <button
            type="button"
            disabled={milestones.length === 0 || isRegenerating}
            onClick={handleApproveAndStart}
            className="px-5 py-2 text-xs font-semibold bg-[#EDEDEB] text-[#111111] hover:bg-white rounded transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <span>{isArabic ? 'اعتماد وبدء البحث' : 'Approve & Start'}</span>
            <ArrowIcon size={14} className="stroke-[2.5]" />
          </button>
        </div>
      </div>
    </div>
  );
};
