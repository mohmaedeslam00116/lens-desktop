import React from 'react';

/**
 * Catalog-driven Settings presentational components (Track A, SPEC #155).
 *
 * Pure (props-in, JSX-out): no fetches, no storage, no Pi imports. The modal
 * owns loading (`GET /api/pi/providers`, `/api/pi/search-providers`) and
 * passes the catalog entries down, so these render EVERY catalog entry —
 * including ids no hardcoded list ever named. Extracted (not inlined) so
 * the suite can SSR-render them against a synthetic 9th-provider catalog
 * without a live engine.
 */

export interface CatalogProviderEntry {
  id: string;
  name: string;
  models: { id: string; name: string }[];
  auth: { configured: boolean; source: string | null };
}

export interface CatalogSearchProviderEntry {
  id: string;
  name: string;
  badge: string;
  descEn: string;
  descAr: string;
  keyField?: string;
}

interface ProviderPillsProps {
  entries: CatalogProviderEntry[];
  selectedId: string;
  isArabic: boolean;
  onSelect: (id: string) => void;
}

/** One pill per catalog entry — the full Pi catalog, named by Pi. */
export const ProviderPills: React.FC<ProviderPillsProps> = ({
  entries,
  selectedId,
  isArabic,
  onSelect,
}) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
    {entries.map((entry) => {
      const isSelected = selectedId === entry.id;
      const standing = entry.auth.configured
        ? (isArabic ? 'مُعد' : 'Ready')
        : (isArabic ? 'يحتاج مفتاحًا' : 'Needs key');
      return (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.id)}
          className={`p-2.5 rounded-xl border text-left rtl:text-right transition ${
            isSelected
              ? 'bg-accent/10 border-accent/60 text-white font-medium '
              : 'bg-surface border-white/5 text-slate-300 hover:bg-hover'
          }`}
        >
          <p className="text-xs truncate font-medium">{entry.name}</p>
          <p className="text-[10px] text-slate-500 truncate mt-0.5">{standing}</p>
        </button>
      );
    })}
  </div>
);

interface SearchProviderKeyFieldProps {
  entry: CatalogSearchProviderEntry;
  value: string;
  isArabic: boolean;
  onChange: (value: string) => void;
}

/**
 * Credential input for a keyed search provider, driven entirely by the
 * catalog entry's `keyField` — no per-provider branches, no closed casts.
 * The field name is generic (`${keyField}-...`); unknown future providers
 * render and save without a code change.
 */
export const SearchProviderKeyField: React.FC<SearchProviderKeyFieldProps> = ({
  entry,
  value,
  isArabic,
  onChange,
}) => (
  <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-2">
    <label className="text-slate-300 font-medium">{entry.name} API Key</label>
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        isArabic ? `مفتاح ${entry.name}...` : `${entry.keyField || entry.id}...`
      }
      className="w-full bg-canvas border border-white/10 rounded-xl px-3.5 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-accent/50"
    />
  </div>
);
