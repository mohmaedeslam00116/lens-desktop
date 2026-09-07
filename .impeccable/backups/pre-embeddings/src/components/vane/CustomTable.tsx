import React, { useState, useMemo } from 'react';
import { Table, Copy, Check, Download, Search, ChevronDown, ChevronUp, FileSpreadsheet } from 'lucide-react';
import { tableToCSV } from '../../utils/markdownArtifacts';
import { Language } from '../../types';

interface CustomTableProps {
  children?: React.ReactNode;
  language?: Language;
}

export const CustomTable: React.FC<CustomTableProps> = ({ children, language = 'ar' }) => {
  const isArabic = language === 'ar';
  const [copied, setCopied] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  // Extract raw text for copying or CSV export
  const handleCopyMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const tableEl = (e.currentTarget.closest('.custom-table-container') as HTMLElement)?.querySelector('table');
    if (!tableEl) return;

    // Convert HTML table to simple markdown string
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return;

    const mdRows = rows.map((r, idx) => {
      const cells = Array.from(r.querySelectorAll('th, td')).map(c => c.textContent?.trim() || '');
      const line = `| ${cells.join(' | ')} |`;
      if (idx === 0) {
        const sep = `| ${cells.map(() => '---').join(' | ')} |`;
        return `${line}\n${sep}`;
      }
      return line;
    });

    navigator.clipboard.writeText(mdRows.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCSV = (e: React.MouseEvent) => {
    e.stopPropagation();
    const tableEl = (e.currentTarget.closest('.custom-table-container') as HTMLElement)?.querySelector('table');
    if (!tableEl) return;

    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return;

    const headers = Array.from(rows[0].querySelectorAll('th, td')).map(c => c.textContent?.trim() || '');
    const dataRows = rows.slice(1).map(r => 
      Array.from(r.querySelectorAll('td')).map(c => c.textContent?.trim() || '')
    );

    const csvContent = tableToCSV(headers, dataRows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Research_Table_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="custom-table-container my-6 rounded-xl border border-line bg-surface/90  overflow-hidden text-xs select-text">
      {/* Table Header Controls */}
      <div className="px-4 py-2.5 bg-panel border-b border-line flex flex-wrap items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-accent/10 border border-accent/20 text-accent flex items-center justify-center">
            <Table className="w-3 h-3" />
          </div>
          <span className="font-semibold text-slate-200 text-xs">
            {isArabic ? 'جدول المقارنة' : 'Comparison table'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Copy Markdown */}
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition text-[11px] border border-white/5"
            title={isArabic ? 'نسخ الجدول' : 'Copy table'}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? (isArabic ? 'تم النسخ' : 'Copied') : (isArabic ? 'نسخ' : 'Copy')}</span>
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface hover:bg-hover text-ink transition text-[11px] border border-line font-medium"
            title={isArabic ? 'تحميل ملف CSV' : 'Download CSV'}
          >
            <FileSpreadsheet className="w-3 h-3" />
            <span>{isArabic ? 'تصدير CSV' : 'Export CSV'}</span>
          </button>

          {/* Collapse Toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 transition"
            title={isExpanded ? (isArabic ? 'طي الجدول' : 'Collapse table') : (isArabic ? 'عرض الجدول' : 'Expand table')}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Table Content */}
      {isExpanded && (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left rtl:text-right border-collapse text-xs">
            {children}
          </table>
        </div>
      )}
    </div>
  );
};
