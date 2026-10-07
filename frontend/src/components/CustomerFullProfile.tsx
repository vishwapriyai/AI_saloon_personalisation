import React, { useEffect, useState } from 'react';
import { RefreshCw, Heart, History, Images, LayoutGrid, Repeat, Trash2, Star, Volume2 } from 'lucide-react';
import { deleteSavedStyle, getCustomerHistory, getCustomerProfile } from '../api/client';
import type { CustomerHistory, CustomerProfile } from '../api/client';
import { CustomerInsights, CustomerSummaryCard } from './CustomerInsights';
import { ComparisonViewer } from './ComparisonViewer';
import { ServiceIcon } from './ServiceIcon';

export interface RepeatableStyle { hairstyle_id: number | null; hairstyle_name: string | null; reference_image_url: string | null }

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்' };
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'styles', label: 'Styles', icon: Heart },
  { key: 'services', label: 'Service History', icon: History },
  { key: 'gallery', label: 'Before / AI / After', icon: Images },
] as const;
type Tab = typeof TABS[number]['key'];

/** Styles to repeat on a new visit: saved favourites first, then previous AI styles (no duplicates). */
function previousStyles(history: CustomerHistory | null): (RepeatableStyle & { key: string; date: string; saved: boolean; saved_id?: number })[] {
  if (!history) return [];
  const seen = new Set<string>();
  const out: (RepeatableStyle & { key: string; date: string; saved: boolean; saved_id?: number })[] = [];
  history.saved_styles.forEach((s) => {
    const k = `${s.style_id}|${s.image_url}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: `saved-${s.id}`, hairstyle_id: s.style_id, hairstyle_name: s.style_name, reference_image_url: s.image_url, date: s.date, saved: true, saved_id: s.id });
  });
  history.selections.forEach((s) => {
    const k = `${s.style_id}|${s.reference_image_url}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: `sel-${s.selection_id}`, hairstyle_id: s.style_id, hairstyle_name: s.style_name, reference_image_url: s.reference_image_url, date: s.date, saved: false });
  });
  (history.ai_previews || []).forEach((g, i) => {
    const k = `${g.style_id}|${g.image_url}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: `gen-${i}`, hairstyle_id: g.style_id, hairstyle_name: g.style_name, reference_image_url: g.image_url, date: g.date, saved: false });
  });
  return out;
}

/** Strip of previous / saved styles with a Repeat button (stylist view and returning-customer view). */
export const PreviousStylesStrip: React.FC<{ history: CustomerHistory | null; onRepeat?: (s: RepeatableStyle) => void; onRemoveSaved?: (savedId: number) => void; limit?: number; narrow?: boolean }> = ({ history, onRepeat, onRemoveSaved, limit, narrow = false }) => {
  const items = previousStyles(history).slice(0, limit);
  if (!items.length) return <p className="text-xs text-slate-500">No previous styles yet.</p>;
  return (
    <div className={`grid grid-cols-2 gap-3 ${narrow ? '' : 'sm:grid-cols-3 lg:grid-cols-4'}`}>
      {items.map((s) => (
        <div key={s.key} className="bg-slate-900/80 border border-slate-700/60 rounded-2xl overflow-hidden flex flex-col">
          <div className="relative aspect-[4/5] bg-slate-950">
            {s.reference_image_url && <img src={s.reference_image_url} alt={s.hairstyle_name || 'Previous style'} className="w-full h-full object-contain" loading="lazy" />}
            {s.saved && (
              <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-rose-500 text-slate-950">
                <Heart className="w-3 h-3 fill-current" /> Saved
              </span>
            )}
            {s.saved && onRemoveSaved && s.saved_id && (
              <button onClick={() => onRemoveSaved(s.saved_id!)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-950/80 text-slate-300 hover:text-white" aria-label="Remove saved style">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-white leading-snug line-clamp-2">{s.hairstyle_name || 'Hairstyle'}</p>
              <p className="text-[10px] text-slate-500">{s.date}</p>
            </div>
            {onRepeat && (
              <button onClick={() => onRepeat(s)} className="min-h-[40px] rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5">
                <Repeat className="w-3.5 h-3.5" /> Repeat Style
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Latest look: Before -> AI preview -> after-cut photo (front / side / back), with clear empty states. */
export const LatestLookCard: React.FC<{ history: CustomerHistory | null }> = ({ history }) => {
  const look = history?.latest_look;
  const status = !look ? null
    : look.status === 'COMPLETED' ? { text: 'Haircut completed', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
    : look.status === 'CONFIRMED' ? { text: 'Style chosen — after-cut photo pending', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
    : { text: 'Previews made — no style chosen yet', cls: 'bg-slate-700/60 text-slate-300 border-slate-600' };
  const aiMissing = look?.ai_failed ? 'AI preview failed — use Generate New Style to retry' : 'No AI preview yet';
  const afterMissing = look?.status === 'COMPLETED' ? 'Not captured' : 'Captured after the haircut';

  return (
    <section className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Images className="w-4 h-4 text-amber-400" /> Latest Look: Style Preview & After Cut
        </h3>
        {look && status && (
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${status.cls}`}>
            {look.style_name ? `${look.style_name} • ` : ''}{look.date} • {status.text}
          </span>
        )}
      </div>
      {!history ? (
        <p className="text-xs text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</p>
      ) : look ? (
        <ComparisonViewer {...look.images} missing={{ before: 'No photo', ai: aiMissing, after: afterMissing }} />
      ) : (
        <p className="text-xs text-slate-500">No photo session yet. Use Generate New Style to take photos and create AI previews.</p>
      )}
    </section>
  );
};

/**
 * Full customer profile: overview, style history (saved / previous AI styles / previous haircut photos),
 * service history and the before / AI / after gallery.
 */
export const CustomerFullProfile: React.FC<{ customerId: number; onRepeat?: (s: RepeatableStyle) => void; header?: React.ReactNode; initialTab?: Tab }> = ({ customerId, onRepeat, header, initialTab = 'overview' }) => {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [galleryVisit, setGalleryVisit] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getCustomerProfile(customerId), getCustomerHistory(customerId)])
      .then(([p, h]) => { if (active) { setProfile(p); setHistory(h); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not load the profile'); });
    return () => { active = false; };
  }, [customerId]);

  const removeSaved = async (savedId: number) => {
    try {
      await deleteSavedStyle(savedId);
      setHistory((h) => (h ? { ...h, saved_styles: h.saved_styles.filter((s) => s.id !== savedId) } : h));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the saved style');
    }
  };

  if (error) return <div role="alert" className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>;
  if (!profile || !history) {
    return <div className="flex items-center justify-center py-12 text-slate-400 gap-3"><RefreshCw className="w-5 h-5 animate-spin text-amber-500" /> Loading profile...</div>;
  }

  const galleryVisits = history.visits.filter((v) => v.images);
  const shownVisit = galleryVisits.find((v) => v.visit_id === galleryVisit) || galleryVisits[0];
  const haircutPhotos = history.visits.filter((v) => v.images?.after.front);

  return (
    <div className="space-y-5">
      <div className="bg-slate-800/80 p-5 sm:p-6 rounded-2xl border border-slate-700/60">
        <CustomerSummaryCard customer={profile} large />
      </div>
      {header}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Profile sections">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-bold border whitespace-nowrap flex items-center gap-2 ${
              tab === key ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
            }`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <CustomerInsights profile={profile} />
          <LatestLookCard history={history} />
          <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl">
            <h3 className="text-sm font-bold text-white mb-3">Frequently Used Services</h3>
            {profile.frequent_services.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {profile.frequent_services.slice(0, 3).map((s) => (
                  <div key={s.name} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/80 border border-slate-700">
                    <ServiceIcon name={s.name} size="lg" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.count} {s.count === 1 ? 'time' : 'times'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-slate-500">No services recorded yet.</p>}
          </div>
        </div>
      )}

      {tab === 'styles' && (
        <div className="space-y-5">
          <section className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl space-y-3">
            <h3 className="text-sm font-bold text-white">Saved & Previous AI Styles</h3>
            <PreviousStylesStrip history={history} onRepeat={onRepeat} onRemoveSaved={removeSaved} />
          </section>
          <section className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl space-y-3">
            <h3 className="text-sm font-bold text-white">Previous Haircut Photos</h3>
            {haircutPhotos.length ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {haircutPhotos.map((v) => (
                  <figure key={v.visit_id} className="space-y-1">
                    <div className="rounded-xl overflow-hidden aspect-[4/5] bg-slate-950 border border-slate-700">
                      <img src={v.images!.after.front!} alt={v.style_name || 'Haircut'} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <figcaption className="text-[10px] text-slate-400 truncate">{v.date} • {v.style_name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : <p className="text-xs text-slate-500">No finished-haircut photos yet.</p>}
          </section>
        </div>
      )}

      {tab === 'services' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden">
          {history.visits.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Service</th>
                    <th className="text-left px-4 py-3">Branch</th>
                    <th className="text-right px-4 py-3">Amount</th>
                    <th className="text-left px-4 py-3">Stylist</th>
                    <th className="text-left px-4 py-3">Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {history.visits.map((v) => (
                    <tr key={v.visit_id} className="text-slate-200 align-top">
                      <td className="px-4 py-3 whitespace-nowrap">{v.date}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {(v.services.length ? v.services : ['Service']).map((s, i) => (
                            <span key={i} className="inline-flex items-center gap-1.5 text-xs"><ServiceIcon name={s} size="sm" />{s}</span>
                          ))}
                        </div>
                        {v.style_name && <p className="text-[11px] text-amber-300 mt-1">{v.style_name}</p>}
                      </td>
                      <td className="px-4 py-3">{v.branch || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{inr(v.amount)}</td>
                      <td className="px-4 py-3">{v.stylist || '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {v.rating ? <span className="inline-flex items-center gap-0.5 text-amber-400">{v.rating}<Star className="w-3 h-3 fill-current" /></span> : '—'}
                        {v.language && <span className="ml-2 inline-flex items-center gap-1 text-slate-400"><Volume2 className="w-3 h-3" />{LANGUAGE_NAMES[v.language] || v.language}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="p-5 text-xs text-slate-500">No visits recorded yet.</p>}
        </div>
      )}

      {tab === 'gallery' && (
        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl space-y-4">
          {shownVisit ? (
            <>
              <div className="flex flex-wrap gap-2">
                {galleryVisits.map((v) => (
                  <button key={v.visit_id} onClick={() => setGalleryVisit(v.visit_id)}
                    className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold border ${
                      v.visit_id === shownVisit.visit_id ? 'bg-slate-700 border-amber-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'
                    }`}>
                    {v.date} • {v.style_name || 'Visit'}
                  </button>
                ))}
              </div>
              <ComparisonViewer key={shownVisit.visit_id} {...shownVisit.images!} />
              {!!shownVisit.instructions.length && (
                <details className="bg-slate-900/70 border border-slate-700 rounded-2xl p-3">
                  <summary className="text-xs font-bold text-slate-300 cursor-pointer">Stylist instructions used{shownVisit.language ? ` (${LANGUAGE_NAMES[shownVisit.language] || shownVisit.language})` : ''}</summary>
                  <ol className="mt-2 space-y-1 text-xs text-slate-300 list-decimal list-inside">
                    {shownVisit.instructions.map((s, i) => <li key={i}>{s.replace(/^\d+[.)]\s*/, '')}</li>)}
                  </ol>
                </details>
              )}
            </>
          ) : <p className="text-xs text-slate-500">Before / AI / After photos appear here after a completed AI-styled service.</p>}
        </div>
      )}
    </div>
  );
};
