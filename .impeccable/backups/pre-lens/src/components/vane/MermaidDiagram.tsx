import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { GitGraph, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  title?: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, title }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        themeVariables: {
          darkMode: true,
          background: '#0c1017',
          mainBkg: '#161b22',
          nodeBorder: '#38bdf8',
          clusterBkg: '#121824',
          clusterBorder: '#30363d',
          lineColor: '#38bdf8',
          textColor: '#f1f5f9',
          primaryColor: '#0369a1',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#38bdf8',
          secondaryColor: '#4338ca',
          tertiaryColor: '#1e293b'
        }
      });

      const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      mermaid.render(uniqueId, code.trim())
        .then(({ svg }) => {
          if (isMounted) {
            setSvgContent(svg);
            setError(null);
          }
        })
        .catch((err) => {
          console.warn('Mermaid render error:', err);
          if (isMounted) {
            setError(err.message || 'Syntax error in Mermaid diagram');
          }
        });
    } catch (e: any) {
      if (isMounted) setError(e.message || 'Failed to initialize diagram');
    }

    return () => {
      isMounted = false;
    };
  }, [code]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-6 rounded-xl border border-[#21262d] bg-[#0c1017] shadow-xl overflow-hidden select-text">
      {/* Header */}
      <div className="px-4 py-2.5 bg-[#161b22] border-b border-[#21262d] flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
            <GitGraph className="w-3 h-3" />
          </div>
          <span className="font-semibold text-slate-200 text-xs">
            {title || 'مخطط المعمارية وتدفق العمليات (Architecture Diagram)'}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-purple-300">
            Mermaid
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyCode}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition text-[11px] border border-white/5"
          title="نسخ كود المخطط"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'تم النسخ' : 'نسخ الكود'}</span>
        </button>
      </div>

      {/* SVG Canvas */}
      <div className="p-4 overflow-x-auto flex items-center justify-center min-h-[140px] bg-[#07090e]/60 custom-scrollbar">
        {error ? (
          <div className="py-4 text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-xs text-amber-400 font-medium">
              <AlertCircle className="w-4 h-4" />
              <span>كود المخطط البياني (Mermaid Source):</span>
            </div>
            <pre className="text-left font-mono text-[11px] p-3 rounded-lg bg-[#161b22] border border-[#21262d] text-slate-300 max-w-lg mx-auto overflow-x-auto">
              {code}
            </pre>
          </div>
        ) : svgContent ? (
          <div 
            ref={containerRef}
            className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="py-6 flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
            <span>جاري تصيير المخطط المعماري...</span>
          </div>
        )}
      </div>
    </div>
  );
};
