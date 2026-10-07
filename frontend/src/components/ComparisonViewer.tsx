import React, { useState } from 'react';
import { ArrowRight, ImageOff } from 'lucide-react';
import type { PhotoView, ViewSet } from '../api/client';

const VIEWS: { key: PhotoView; label: string }[] = [
  { key: 'front', label: 'Front' }, { key: 'side', label: 'Side' }, { key: 'back', label: 'Back' },
];
const STAGES = [
  { key: 'before', label: 'Before', sub: 'Current photo', cls: 'text-slate-200 border-slate-600' },
  { key: 'ai', label: 'AI Preview', sub: 'Generated look', cls: 'text-amber-300 border-amber-500/60' },
  { key: 'after', label: 'Actual Result', sub: 'After the service', cls: 'text-emerald-300 border-emerald-500/60' },
] as const;

interface Props {
  before: ViewSet;
  ai: ViewSet;
  after: ViewSet;
  /** Placeholder text per stage when a photo is missing */
  missing?: Partial<Record<'before' | 'ai' | 'after', string>>;
}

/** Front | Side | Back tabs; each shows Before -> AI Preview -> Actual Result, clearly separated. */
export const ComparisonViewer: React.FC<Props> = ({ before, ai, after, missing = {} }) => {
  const sets = { before, ai, after };
  const available = VIEWS.filter((v) => before[v.key] || ai[v.key] || after[v.key]);
  const [view, setView] = useState<PhotoView>(available[0]?.key || 'front');

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Photo view">
        {VIEWS.map((v) => {
          const has = before[v.key] || ai[v.key] || after[v.key];
          return (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={`flex-1 sm:flex-none min-h-[44px] px-5 rounded-xl text-sm font-bold border transition-all ${
                view === v.key ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              } ${has ? '' : 'opacity-60'}`}>
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 sm:gap-3">
        {STAGES.map((stage, i) => {
          const url = sets[stage.key][view];
          return (
            <React.Fragment key={stage.key}>
              {i > 0 && <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" aria-hidden="true" />}
              <figure className="space-y-1.5 min-w-0">
                <figcaption className="text-center">
                  <span className={`text-[11px] sm:text-xs font-bold uppercase tracking-wide ${stage.cls.split(' ')[0]}`}>{i + 1}. {stage.label}</span>
                  <span className="block text-[10px] text-slate-500 truncate">{stage.sub}</span>
                </figcaption>
                <div className={`rounded-xl overflow-hidden aspect-[4/5] bg-slate-950 border-2 ${stage.cls.split(' ').slice(1).join(' ')} flex items-center justify-center`}>
                  {url ? (
                    <img src={url} alt={`${stage.label} — ${view}`} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[10px] sm:text-[11px] text-slate-500 flex flex-col items-center gap-1 px-2 text-center">
                      <ImageOff className="w-4 h-4" /> {missing[stage.key] || 'Not captured'}
                    </span>
                  )}
                </div>
              </figure>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
