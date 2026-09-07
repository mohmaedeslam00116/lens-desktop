import React from 'react';
import { Files, Plus, Search, Settings, Radio } from 'lucide-react';

export type ActivePanel = 'explorer' | 'search';

interface ActivityBarProps {
  activePanel: ActivePanel;
  onSelectPanel: (panel: ActivePanel) => void;
  onNewResearch: () => void;
  onOpenSettings: () => void;
  isInspectorOpen: boolean;
  onToggleInspector: () => void;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activePanel,
  onSelectPanel,
  onNewResearch,
  onOpenSettings,
  isInspectorOpen,
  onToggleInspector,
}) => {
  return (
    <aside className="w-12 h-full bg-vscode-activitybar border-r border-vscode-border flex flex-col items-center justify-between py-2 select-none z-20 flex-shrink-0">
      {/* Top action icons */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Explorer icon */}
        <button
          onClick={() => onSelectPanel('explorer')}
          className="relative w-12 h-10 flex items-center justify-center text-vscode-textMuted hover:text-vscode-textActive transition"
          title="مستكشف الأبحاث (Ctrl+Shift+E)"
        >
          {activePanel === 'explorer' && (
            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-vscode-accent" />
          )}
          <Files className={`w-5 h-5 ${activePanel === 'explorer' ? 'text-vscode-textActive' : 'text-vscode-textMuted'}`} />
        </button>

        {/* New Research icon */}
        <button
          onClick={onNewResearch}
          className="relative w-12 h-10 flex items-center justify-center text-vscode-textMuted hover:text-blue-400 transition"
          title="بدء بحث عميق جديد (Ctrl+N)"
        >
          <Plus className="w-5 h-5" />
        </button>

        {/* Toggle Agent Inspector / Composer icon */}
        <button
          onClick={onToggleInspector}
          className="relative w-12 h-10 flex items-center justify-center text-vscode-textMuted hover:text-vscode-textActive transition"
          title="لوحة المساعد الذكي ورادار الوكيل (Ctrl+I)"
        >
          {isInspectorOpen && (
            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-blue-500" />
          )}
          <Radio className={`w-5 h-5 ${isInspectorOpen ? 'text-blue-400' : 'text-vscode-textMuted'}`} />
        </button>
      </div>

      {/* Bottom Settings icon */}
      <div className="flex flex-col items-center gap-2 w-full">
        <button
          onClick={onOpenSettings}
          className="w-12 h-10 flex items-center justify-center text-vscode-textMuted hover:text-vscode-textActive transition"
          title="إعدادات النماذج والـ API"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
};
