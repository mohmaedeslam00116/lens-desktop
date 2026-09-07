import React from 'react';
import { Info, Lightbulb, BookmarkCheck, AlertTriangle, ShieldAlert } from 'lucide-react';

interface CalloutAlertProps {
  children?: React.ReactNode;
}

export const CalloutAlert: React.FC<CalloutAlertProps> = ({ children }) => {
  // Extract text from children to check for [!NOTE], [!TIP], etc.
  let text = '';
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string') text += child;
    else if (React.isValidElement(child) && (child.props as any)?.children) {
      const subChildren = (child.props as any).children;
      if (typeof subChildren === 'string') text += subChildren;
    }
  });

  const isNote = /\[!NOTE\]/i.test(text);
  const isTip = /\[!TIP\]/i.test(text);
  const isImportant = /\[!IMPORTANT\]/i.test(text);
  const isWarning = /\[!WARNING\]/i.test(text);
  const isCaution = /\[!CAUTION\]/i.test(text);

  if (!isNote && !isTip && !isImportant && !isWarning && !isCaution) {
    // Normal blockquote
    return (
      <blockquote className="my-4 border border-white/10 bg-[#121824]/60 px-4 py-3 text-slate-300 italic rounded-xl">
        {children}
      </blockquote>
    );
  }

  const config = isCaution
    ? {
        title: 'تحذير أمني ومخاطر عالية (Caution)',
        icon: ShieldAlert,
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/30',
        textColor: 'text-rose-300',
        iconColor: 'text-rose-400',
      }
    : isWarning
    ? {
        title: 'تنبيه تشغيلي وقيود هامة (Warning)',
        icon: AlertTriangle,
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        textColor: 'text-amber-300',
        iconColor: 'text-amber-400',
      }
    : isImportant
    ? {
        title: 'نقطة محورية واستراتيجية (Important)',
        icon: BookmarkCheck,
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/30',
        textColor: 'text-purple-300',
        iconColor: 'text-purple-400',
      }
    : isTip
    ? {
        title: 'توصية تنفيذية رائدة (Pro Tip)',
        icon: Lightbulb,
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        textColor: 'text-emerald-300',
        iconColor: 'text-emerald-400',
      }
    : {
        title: 'الخلاصة الاستراتيجية (Key Insight)',
        icon: Info,
        bg: 'bg-sky-500/10',
        border: 'border-sky-500/30',
        textColor: 'text-sky-300',
        iconColor: 'text-sky-400',
      };

  const Icon = config.icon;

  return (
    <div className={`my-4 p-4 rounded-xl border ${config.border} ${config.bg} space-y-2 select-text transition`}>
      <div className="flex items-center gap-2 font-semibold text-xs select-none">
        <Icon className={`w-4 h-4 ${config.iconColor} shrink-0`} />
        <span className={config.textColor}>{config.title}</span>
      </div>
      <div className="text-slate-200 text-xs leading-relaxed [&>p]:m-0 [&>p]:first-of-type:mt-0">
        {children}
      </div>
    </div>
  );
};
