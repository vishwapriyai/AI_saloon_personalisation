import React, { useEffect, useState } from 'react';
import { RefreshCw, Heart, History, Images, LayoutGrid, Repeat, Trash2, Star, Volume2, MapPin } from 'lucide-react';
import { deleteSavedStyle, getCustomerHistory, getCustomerProfile } from '../api/client';
import type { CustomerHistory, CustomerProfile } from '../api/client';
import { CustomerAvatar, CustomerInsights, CustomerTypeBadge } from './CustomerInsights';
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
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  if (!items.length) return <p className="text-xs text-[#8a9a92]">No previous styles yet.</p>;
  return (
    <div className={`grid grid-cols-2 gap-3 ${narrow ? '' : 'sm:grid-cols-3 lg:grid-cols-4'}`}>
      {items.map((s) => (
        <div key={s.key} className="group flex flex-col overflow-hidden rounded-xl border border-[#dfe7e1] bg-[#ffffff] transition-shadow hover:shadow-md">
          <div className="relative aspect-[4/5] bg-[#f3f5f3]">
            {s.reference_image_url && !failed[s.key] ? (
              <img src={s.reference_image_url} alt={s.hairstyle_name || 'Previous style'} className="h-full w-full object-cover" loading="lazy"
                onError={() => setFailed((f) => ({ ...f, [s.key]: true }))} />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] text-[#8a9a92]">Photo not available</span>
            )}
            {s.saved && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-[#ffffff]">
                <Heart className="size-3 fill-current" /> Saved
              </span>
            )}
            {s.saved && onRemoveSaved && s.saved_id && (
              <button onClick={() => onRemoveSaved(s.saved_id!)} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-[#ffffff]/90 text-[#6c7e73] hover:text-rose-600 cursor-pointer" aria-label="Remove saved style">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-1 flex-col justify-between gap-2 p-2.5">
            <div>
              <p className="line-clamp-2 text-xs font-bold leading-snug text-[#1a2a20]">{s.hairstyle_name || 'Hairstyle'}</p>
              <p className="text-[10px] text-[#8a9a92]">{s.date}</p>
            </div>
            {onRepeat && (
              <button onClick={() => onRepeat(s)} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#c3d3c9] text-xs font-semibold text-[#2f5d46] transition-colors hover:border-[#2f5d46] hover:bg-[#f2f8f4] cursor-pointer">
                <Repeat className="size-3.5" /> Repeat style
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Profile header: avatar, name, type, a stat strip, then services and branches as chips. */
export const ProfileCard: React.FC<{ profile: CustomerProfile; compact?: boolean }> = ({ profile: c, compact = false }) => {
  const stats = [
    { label: 'Visits', value: String(c.total_visits) },
    { label: 'Avg spend', value: inr(c.average_spend ?? 0) },
    { label: 'Total spend', value: inr(c.total_spent ?? 0) },
    { label: c.branches_visited_count === 1 ? 'Branch' : 'Branches', value: String(c.branches_visited_count ?? 0) },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff]">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <CustomerAvatar name={c.full_name} url={c.avatar_url} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-xl font-bold text-[#1a2a20]">{c.full_name}</h3>
            <CustomerTypeBadge type={c.customer_type} />
          </div>
          <p className="mt-0.5 text-xs text-[#6c7e73]">Customer ID <span className="font-semibold text-[#2f5d46]">{c.customer_code}</span></p>
        </div>
      </div>

      <dl className={`grid grid-cols-2 border-t border-[#ebf0ec] ${compact ? '' : 'sm:grid-cols-4'}`}>
        {stats.map((s, i) => (
          <div key={s.label} className={`px-5 py-3.5 ${i % 2 ? 'border-l' : ''} ${i >= 2 ? (compact ? 'border-t' : 'border-t sm:border-t-0') : ''} ${i === 2 && !compact ? 'sm:border-l' : ''} border-[#ebf0ec]`}>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#8a9a92]">{s.label}</dt>
            <dd className="mt-0.5 text-lg font-bold text-[#1a2a20]">{s.value}</dd>
          </div>
        ))}
      </dl>

      {(!!c.frequent_services?.length || !!c.branches_visited?.length) && (
        <div className={`flex flex-wrap gap-y-4 border-t border-[#ebf0ec] bg-[#fafcfa] px-5 py-4 ${compact ? 'flex-col' : 'gap-x-10'}`}>
          {!!c.frequent_services?.length && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#8a9a92]">Top services</p>
              <div className="flex flex-wrap gap-1.5">
                {c.frequent_services.slice(0, 3).map((s) => (
                  <span key={s.name} className="inline-flex max-w-full items-center gap-2 rounded-xl bg-[#ffffff] py-1.5 pl-1.5 pr-2 text-xs font-semibold text-[#33483c] ring-1 ring-[#dfe7e1]">
                    <ServiceIcon name={s.name} size="sm" />
                    <span className="truncate">{s.name}</span>
                    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#244a37] px-1.5 text-[10px] font-bold text-[#ffffff]" title={`${s.count} ${s.count === 1 ? 'time' : 'times'}`}>
                      {s.count}×
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {!!c.branches_visited?.length && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#8a9a92]">Branches visited</p>
              <div className="flex flex-wrap gap-1.5">
                {c.branches_visited.map((b) => (
                  <span key={b} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#ffffff] px-3 text-xs font-medium text-[#33483c] ring-1 ring-[#dfe7e1]">
                    <MapPin aria-hidden="true" className="size-3.5 text-[#2f5d46]" /> {b}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Latest look: Before -> AI preview -> after-cut photo (front / side / back), with clear empty states. */
export const LatestLookCard: React.FC<{ history: CustomerHistory | null }> = ({ history }) => {
  const look = history?.latest_look;
  const status = !look ? null
    : look.status === 'COMPLETED' ? { text: 'Haircut completed', cls: 'bg-[#e4eee7] text-[#244a37]' }
    : look.status === 'CONFIRMED' ? { text: 'Style chosen — after-cut photo pending', cls: 'bg-[#fdf3d7] text-[#7a5a0c]' }
    : { text: 'Previews made — no style chosen yet', cls: 'bg-[#f1f4f1] text-[#6c7e73]' };
  const aiMissing = look?.ai_failed ? 'AI preview failed — use Generate New Style to retry' : 'No AI preview yet';
  const afterMissing = look?.status === 'COMPLETED' ? 'Not captured' : 'Captured after the haircut';

  return (
    <section className="space-y-4 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#1a2a20]">
            <Images className="size-4 text-[#2f5d46]" /> Your latest look
          </h3>
          {look && <p className="mt-0.5 text-xs text-[#6c7e73]">{look.style_name || 'Hairstyle'} · {look.date}</p>}
        </div>
        {look && status && (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.cls}`}>{status.text}</span>
        )}
      </div>
      {!history ? (
        <p className="flex items-center gap-2 text-xs text-[#6c7e73]"><RefreshCw className="size-4 animate-spin" /> Loading…</p>
      ) : look ? (
        <ComparisonViewer {...look.images} missing={{ before: 'No photo', ai: aiMissing, after: afterMissing }} />
      ) : (
        <p className="text-xs text-[#8a9a92]">No photo session yet. Use Generate new style to take photos and create AI previews.</p>
      )}
    </section>
  );
};

/**
 * Full customer profile: overview, style history (saved / previous AI styles / previous haircut photos),
 * service history and the before / AI / after gallery.
 */
export const CustomerFullProfile: React.FC<{ customerId: number; onRepeat?: (s: RepeatableStyle) => void; header?: React.ReactNode; initialTab?: Tab; hideProfileCard?: boolean }> = ({ customerId, onRepeat, header, initialTab = 'overview', hideProfileCard = false }) => {
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
      {!hideProfileCard && <ProfileCard profile={profile} />}
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
