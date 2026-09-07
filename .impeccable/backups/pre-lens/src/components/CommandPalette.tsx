import React, { useState, useEffect } from 'react';
import { 
  Command, 
  Search, 
  Plus, 
  Settings, 
  Globe, 
  Download, 
  FileText, 
  FileDown, 
  Cpu, 
  X,
  Sparkles,
  Zap
} from 'lucide-react';
import { Language, ApiSettings } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onNewResearch: () => void;
  onOpenSettings: () => void;
  onToggleLanguage: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  hasActiveReport: boolean;
  settings: ApiSettings;
  onUpdateSettings: (newSettings: ApiSettings) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  language,
  onNewResearch,
  onOpenSettings,
  onToggleLanguage,
  onExport,
  hasActiveReport,
  settings,
  onUpdateSettings,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const commands = [
    {
      id: 'new',
      title: 'بدء بحث عميق جديد',
      category: 'عام',
      icon: Plus,
      shortcut: 'Ctrl+N',
      action: () => {
        onNewResearch();
        onClose();
      }
    },
    {
      id: 'lang',
      title: language === 'ar' ? 'Switch Language to English' : 'تغيير اللغة إلى العربية',
      category: 'التفضيلات',
      icon: Globe,
      action: () => {
        onToggleLanguage();
        onClose();
      }
    },
    {
      id: 'settings',
      title: 'فتح إعدادات النماذج ومفاتيح API',
      category: 'التفضيلات',
      icon: Settings,
      action: () => {
        onOpenSettings();
        onClose();
      }
    },
    ...(hasActiveReport ? [
      {
        id: 'export-pdf',
        title: 'تصدير التقرير الحالي كـ PDF',
        category: 'التصدير',
        icon: FileDown,
        action: () => {
          onExport('pdf');
          onClose();
        }
      },
      {
        id: 'export-docx',
        title: 'تصدير التقرير الحالي كـ Word (.docx)',
        category: 'التصدير',
        icon: FileText,
        action: () => {
          onExport('docx');
          onClose();
        }
      },
      {
        id: 'export-md',
        title: 'تصدير التقرير الحالي كـ Markdown',
        category: 'التصدير',
        icon: Download,
        action: () => {
          onExport('markdown');
          onClose();
        }
      }
    ] : []),
    {
      id: 'model-gemini',
      title: 'التبديل إلى Google Gemini (2.0 Flash / 1.5 Pro)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'gemini' });
        onClose();
      }
    },
    {
      id: 'model-openai',
      title: 'التبديل إلى OpenAI (GPT-4o / o3-mini)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'openai' });
        onClose();
      }
    },
    {
      id: 'model-anthropic',
      title: 'التبديل إلى Anthropic Claude (3.7 Sonnet / Haiku)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'anthropic' });
        onClose();
      }
    },
    {
      id: 'model-deepseek',
      title: 'التبديل إلى DeepSeek (V3 / R1 Reasoner)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'deepseek' });
        onClose();
      }
    },
    {
      id: 'model-groq',
      title: 'التبديل إلى Groq Ultra-Fast (Llama 3.3 70B)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'groq' });
        onClose();
      }
    },
    {
      id: 'model-ollama',
      title: 'التبديل إلى Ollama المحلي (Local Private LLM)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'ollama' });
        onClose();
      }
    },
    {
      id: 'model-openrouter',
      title: 'التبديل إلى OpenRouter (Universal Gateway 250+ Models)',
      category: 'النماذج والذكاء الاصطناعي',
      icon: Cpu,
      action: () => {
        onUpdateSettings({ ...settings, llm_provider: 'openrouter' });
        onClose();
      }
    },
    {
      id: 'search-ddg',
      title: 'استخدام DuckDuckGo كمحرك بحث مجاني',
      category: 'محركات البحث',
      icon: Zap,
      action: () => {
        onUpdateSettings({ ...settings, search_provider: 'duckduckgo' });
        onClose();
      }
    },
    {
      id: 'search-tavily',
      title: 'استخدام Tavily AI Search',
      category: 'محركات البحث',
      icon: Zap,
      action: () => {
        onUpdateSettings({ ...settings, search_provider: 'tavily' });
        onClose();
      }
    }
  ];

  const filtered = commands.filter(c =>
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-xl bg-obsidian-panel border border-obsidian-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input */}
        <div className="p-3.5 border-b border-obsidian-border flex items-center gap-3 bg-obsidian-surface/50">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="اكتب أمراً أو ابحث في الإجراءات..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-400 border border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Commands List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1 text-xs">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              لا توجد أوامر مطابقة لما كتبت.
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const Icon = cmd.icon;
              return (
                <div
                  key={cmd.id}
                  onClick={cmd.action}
                  className="flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition text-slate-300 hover:bg-obsidian-surface hover:text-white group border border-transparent hover:border-obsidian-border"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-obsidian-base text-slate-400 group-hover:text-blue-400 group-hover:bg-blue-500/10 flex items-center justify-center flex-shrink-0 transition">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-medium text-[11px]">{cmd.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 group-hover:text-slate-300">
                      {cmd.category}
                    </span>
                    {cmd.shortcut && (
                      <kbd className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-800 text-slate-400 border border-slate-700">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
