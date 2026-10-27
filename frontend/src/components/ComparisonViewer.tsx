import React, { useState } from 'react';
import { ArrowRight, ImageOff } from 'lucide-react';
import type { PhotoView, ViewSet } from '../api/client';

type Stage = 'before' | 'ai' | 'after';

const VIEWS: { key: PhotoView; label: string }[] = [
  { key: 'front', label: 'Front' }, { key: 'side', label: 'Side' }, { key: 'back', label: 'Back' },
];
const STAGES: { key: Stage; label: string; sub: string; accent: string }[] = [
  { key: 'before', label: 'Before', sub: 'Current photo', accent: 'bg-[#a3b3a9]' },
  { key: 'ai', label: 'AI preview', sub: 'Generated look', accent: 'bg-[#e9b949]' },
  { key: 'after', label: 'Result', sub: 'After the service', accent: 'bg-[#2f5d46]' },
];

interface Props {
  before: ViewSet;
  ai: ViewSet;
  after: ViewSet;
  /** Placeholder text per stage when a photo is missing */
  missing?: Partial<Record<Stage, string>>;
}

/** Front | Side | Back tabs; each shows Before -> AI preview -> Result side by side. */
export const ComparisonViewer: React.FC<Props> = ({ before, ai, after, missing = {} }) => {
  const sets: Record<Stage, ViewSet> = { before, ai, after };
  const available = VIEWS.filter((v) => before[v.key] || ai[v.key] || after[v.key]);
  const [view, setView] = useState<PhotoView>(available[0]?.key || 'front');
  // Photos whose file could not be loaded (e.g. missing on this server): shown as a placeholder
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-5">
      {/* View switch: small rounded segmented control */}
      <div role="tablist" aria-label="Photo view" className="inline-flex items-center gap-0.5 rounded-full bg-[#eef3ee] p-1">
        {VIEWS.map((v) => {
          const on = view === v.key;
          const has = before[v.key] || ai[v.key] || after[v.key];
          return (
            <button
              key={v.key}
              role="tab"
              aria-selected={on}
              onClick={() => setView(v.key)}
              className={`h-8 rounded-full px-4 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f5d46]/30 cursor-pointer ${
                on ? 'bg-[#ffffff] text-[#1a2a20] shadow-sm' : has ? 'text-[#4f6b5a] hover:text-[#1a2a20]' : 'text-[#b9c4bd]'
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Before -> AI preview -> Result */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 sm:gap-4">
        {STAGES.map((s, i) => {
          const url = sets[s.key][view];
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <ArrowRight aria-hidden="true" className="size-4 text-[#b9c4bd] sm:size-5" />}
              <figure className="min-w-0">
                <div className="aspect-[4/5] overflow-hidden rounded-xl bg-[#f3f5f3]">
                  {url && !failed[url] ? (
                    <img
                      src={url}
                      alt={`${s.label} — ${view}`}
                      className="h-full w-full object-cover"
                      onError={() => setFailed((f) => ({ ...f, [url]: true }))}
                    />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center text-[11px] text-[#8a9a92]">
                      <ImageOff aria-hidden="true" className="size-5 text-[#c3cdc6]" />
                      {url ? 'Photo not available' : (missing[s.key] || 'Not captured')}
                    </span>
                  )}
                </div>
                <figcaption className="mt-2.5 text-center">
                  <span className="flex items-center justify-center gap-1.5 text-xs font-bold text-[#1a2a20] sm:text-sm">
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${s.accent}`} /> {s.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#8a9a92] sm:text-[11px]">{s.sub}</span>
                </figcaption>
              </figure>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
