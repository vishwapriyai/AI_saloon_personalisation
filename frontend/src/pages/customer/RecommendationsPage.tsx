import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight, RefreshCw, ImageOff, Sparkles, Heart, AlertTriangle, Info } from 'lucide-react';
import { saveSelection, generateStyleImages, generateSelectionViews, saveFavouriteStyle } from '../../api/client';
import { currentCustomerId } from '../../auth/session';

/** Most looks the recommendation returns (backend STYLE_RECOMMENDATION_COUNT). */
const MAX_LOOKS = 8;

const STEPS = ['Photos', 'Preferences', 'Your look', 'Stylist guide'];

const SERVICE_LABELS: Record<string, string> = { Beard: 'Beard', Colour: 'Colour', Texture: 'Smoothening / Perm' };

// The main card image is ONLY ever the customer's own edited photo. Catalogue photos are shown
// separately and labelled "Style Reference"; they are never presented as a personalized preview.
const withGeneration = (rec: any, gen: any) => {
  const generated = gen && gen.status === 'COMPLETED' && gen.generated_image_url ? gen.generated_image_url : undefined;
  return {
    ...rec,
    generated_image_url: generated,
    display_image: generated,
    generation_status: gen ? (generated ? 'COMPLETED' : 'FAILED') : 'NOT_GENERATED',
    generation_error: gen?.error || null,
  };
};

export const RecommendationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [styles, setStyles] = useState<any[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, 'saving' | 'saved' | 'error'>>({});

  const handleSaveStyle = async (style: any) => {
    if (!style.generated_image_url) return;
    setSaved((s) => ({ ...s, [style.style_id]: 'saving' }));
    try {
      await saveFavouriteStyle(currentCustomerId(), {
        style_id: style.style_id,
        image_url: style.generated_image_url,
        recommendation_id: Number(localStorage.getItem('salon_recommendation_id') || 0) || undefined,
      });
      setSaved((s) => ({ ...s, [style.style_id]: 'saved' }));
    } catch (err) {
      console.error(err);
      setSaved((s) => ({ ...s, [style.style_id]: 'error' }));
    }
  };
  const startedGeneration = useRef(false);

  const handleRetry = async (styleId: number) => {
    const recId = Number(localStorage.getItem('salon_recommendation_id') || 0);
    setRetrying((r) => ({ ...r, [styleId]: true }));
    let gen: any;
    try {
      // The same trim choice that picked the looks also shapes the previews (e.g. "keep length" vs a real cut)
      const trim = localStorage.getItem('salon_trim_preference') || undefined;
      const res = await generateStyleImages({ recommendation_id: recId, selected_style_ids: [styleId], trim_preference: trim });
      gen = res?.generations?.[0];
    } catch (err) {
      console.error(err);
      gen = { style_id: styleId, status: 'FAILED', generated_image_url: '',
        error: err instanceof Error && err.message ? err.message : 'Preview generation failed. Please try again.' };
    }
    setStyles((prev) => prev.map((s) => (s.style_id === styleId ? withGeneration(s, gen) : s)));
    try {
      const saved = JSON.parse(localStorage.getItem('salon_generated_results') || '[]').filter((g: any) => g.style_id !== styleId);
      localStorage.setItem('salon_generated_results', JSON.stringify([...saved, gen]));
    } catch { /* storage unavailable: the page state is still updated */ }
    setRetrying((r) => ({ ...r, [styleId]: false }));
  };

  useEffect(() => {
    const rawRecs = localStorage.getItem('salon_recommended_styles');
    const rawGens = localStorage.getItem('salon_generated_results');

    if (rawRecs) {
      try {
        const parsedRecs = JSON.parse(rawRecs);
        const parsedGens = rawGens ? JSON.parse(rawGens) : [];

        const merged = parsedRecs.map((rec: any) => {
          const styleId = rec.style_id || rec.id;
          const genMatch = parsedGens.find((g: any) => g.style_id === styleId || g.id === styleId);
          return withGeneration({ ...rec, style_id: styleId }, genMatch);
        });
        setStyles(merged);
        // Returning customer: pre-select the hairstyle they chose last time if it is among these looks
        const lastHairstyleId = Number(localStorage.getItem('salon_last_hairstyle_id') || 0);
        const previous = merged.find((s: any) => s.style_id === lastHairstyleId);
        if (merged.length > 0) setSelectedStyleId(previous ? previous.style_id : merged[0].style_id);

        // Coming from the Generate step: create each preview independently so every card fills in as
        // soon as its own image is ready (slow free GPUs can take a minute or two per image).
        if (localStorage.getItem('salon_generation_pending') === '1' && !startedGeneration.current) {
          startedGeneration.current = true;
          localStorage.removeItem('salon_generation_pending');
          merged
            .filter((s: any) => s.generation_status === 'NOT_GENERATED' && s.feasible !== false)
            .forEach((s: any) => handleRetry(s.style_id));
        }
        return;
      } catch (e) {
        console.error("Error parsing recommendations from localStorage:", e);
      }
    }

    // Fallback: Fetch default style catalogue directly from backend API if localStorage is empty
    fetch('/api/v1/hairstyles')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const formatted = data.map((item: any) => withGeneration({ ...item, style_id: item.id }, null));
          setStyles(formatted);
          if (formatted.length > 0) setSelectedStyleId(formatted[0].style_id);
        }
      })
      .catch((err) => console.error("Failed to load fallback hairstyles:", err));
  }, []);


  const handleConfirmSelection = async () => {
    if (!selectedStyleId) return;
    const customerId = currentCustomerId();
    const chosen = styles.find((s) => s.style_id === selectedStyleId);

    try {
      const res = await saveSelection({
        customer_id: customerId,
        hairstyle_id: selectedStyleId,
        reference_image_url: chosen?.generated_image_url || '',
        recommendation_id: Number(localStorage.getItem('salon_recommendation_id') || 0) || undefined,
      });
      localStorage.setItem('salon_selection_id', String(res.selection_id));
      localStorage.setItem('salon_selected_style', JSON.stringify(chosen));
      // Side/back AI previews are generated in the background; the instructions page shows them when ready
      generateSelectionViews(res.selection_id).catch((e) => console.warn('Side/back previews unavailable', e));
      navigate('/customer/instructions');
    } catch (err) {
      console.error(err);
      localStorage.removeItem('salon_selection_id');
      localStorage.setItem('salon_selected_style', JSON.stringify(chosen));
      navigate('/customer/instructions');
    }
  };

  // Only looks the customer's hair can have today are shown (older saved results may still contain others)
  const shownStyles = styles.filter((s) => s.feasible !== false);

  const readyCount = shownStyles.filter((s) => s.generated_image_url).length;
  const creatingCount = shownStyles.filter((s) => retrying[s.style_id]).length;
  const chosen = shownStyles.find((s) => s.style_id === selectedStyleId);
  const chosenIdx = shownStyles.findIndex((s) => s.style_id === selectedStyleId);
  const canConfirm = !!chosen?.generated_image_url;
  const saveState = chosen ? saved[chosen.style_id] : undefined;

  /** Image area of a look in every state; `big` is the main preview, otherwise a thumbnail. */
  const preview = (style: any, big: boolean) => {
    if (style.generated_image_url) {
      return (
        <img
          src={style.generated_image_url}
          alt={`You with ${style.name}`}
          loading={big ? 'eager' : 'lazy'}
          className={`h-full w-full object-cover ${big ? 'object-center' : 'object-top'}`}
        />
      );
    }
    if (style.feasible === false && !retrying[style.style_id]) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#fdf8e8] p-3 text-center">
          <AlertTriangle aria-hidden="true" className={big ? 'size-9 text-[#a3602c]' : 'size-5 text-[#a3602c]'} />
          <p className={`font-semibold text-[#6b4a1c] ${big ? 'text-sm' : 'text-[10px]'}`}>Not suitable today</p>
          {big && <p className="max-w-xs text-xs text-[#6b5a22]">{style.feasibility_warning}</p>}
          {big && style.suggested_alternative && (
            <p className="text-xs text-[#2f5d46]">Try instead: <b>{style.suggested_alternative.name}</b></p>
          )}
        </div>
      );
    }
    if (retrying[style.style_id]) {
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
          <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-gradient-to-b from-[#eef3ee] via-[#e4eee7] to-[#eef3ee]" />
          <span className={`relative grid place-items-center rounded-full bg-[#ffffff] shadow-sm ${big ? 'size-16' : 'size-9'}`}>
            <Sparkles aria-hidden="true" className={`animate-pulse text-[#c9971f] ${big ? 'size-7' : 'size-4'}`} />
          </span>
          <p className={`relative font-semibold text-[#1a2a20] ${big ? 'text-sm' : 'text-[10px]'}`}>Creating…</p>
          {big && <p className="relative text-xs text-[#6c7e73]">This can take up to a couple of minutes.</p>}
        </div>
      );
    }
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
        <ImageOff aria-hidden="true" className={big ? 'size-9 text-[#a3b3a9]' : 'size-5 text-[#a3b3a9]'} />
        <p className={`font-semibold text-[#33483c] ${big ? 'text-sm' : 'text-[10px]'}`}>Preview unavailable</p>
        {big && style.generation_error && <p className="line-clamp-3 max-w-xs text-xs text-[#6c7e73]">{style.generation_error}</p>}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleRetry(style.style_id); }}
          className={`flex items-center gap-1.5 rounded-full bg-[#244a37] font-semibold text-[#ffffff] hover:bg-[#1b392b] cursor-pointer ${big ? 'h-10 px-4 text-sm' : 'h-7 px-2.5 text-[10px]'}`}
        >
          <RefreshCw aria-hidden="true" className={big ? 'size-4' : 'size-3'} />
          {style.generation_status === 'NOT_GENERATED' ? 'Create' : 'Retry'}
        </button>
      </div>
    );
  };

  return (
    <div className="auth-rise flex-1 py-2 sm:py-4">
      <div className="w-full overflow-clip rounded-3xl border border-[#dfe7e1] bg-[#ffffff] shadow-[0_24px_60px_-30px_rgba(36,74,55,0.35)]">
        {/* Header band */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-5 sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">Step 3 of 4</p>
              <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-[#ffffff]">
                Your top {shownStyles.length} {shownStyles.length === 1 ? 'look' : 'looks'}
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[#ffffff]/75">
                {shownStyles.length > 0 && shownStyles.length < MAX_LOOKS
                  ? `Based on your hair length and facial features, these ${shownStyles.length} styles are the ones we can create for you today.`
                  : 'Your own photo with each recommended style.'}
              </p>
            </div>
            <div className="hidden shrink-0 rounded-2xl bg-[#ffffff]/10 px-4 py-2.5 text-right ring-1 ring-[#ffffff]/10 sm:block">
              <p className="text-sm font-semibold text-[#ffffff]">{readyCount} of {shownStyles.length} ready</p>
              <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-[#ffffff]/65">
                {creatingCount > 0 ? (<><Sparkles aria-hidden="true" className="size-3.5 animate-pulse text-[#f3d27a]" /> Creating {creatingCount}…</>) : 'Previews'}
              </p>
            </div>
          </div>

          <ol aria-label="Progress, step 3 of 4" className="relative mt-4 hidden items-center gap-2 sm:flex">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <li className="flex items-center gap-2" aria-current={i === 2 ? 'step' : undefined}>
                  <span className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
                    i === 2 ? 'bg-[#f3d27a] text-[#1d3d2d]' : i < 2 ? 'bg-[#ffffff]/90 text-[#1d3d2d]' : 'bg-[#ffffff]/10 text-[#ffffff]/60'
                  }`}>
                    {i < 2 ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
                  </span>
                  <span className={`text-xs ${i === 2 ? 'font-semibold text-[#ffffff]' : i < 2 ? 'text-[#ffffff]/85' : 'text-[#ffffff]/60'}`}>{label}</span>
                </li>
                {i < STEPS.length - 1 && <span className={`h-px min-w-3 flex-1 ${i < 2 ? 'bg-[#ffffff]/50' : 'bg-[#ffffff]/15'}`} />}
              </React.Fragment>
            ))}
          </ol>
        </div>

        <div className="grid items-start gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* LEFT: selected look, large */}
          {chosen && (
            <div className="flex flex-col gap-4 lg:sticky lg:top-24">
              <div className="relative mx-auto aspect-[4/5] h-[min(34rem,calc(100vh-17rem))] min-h-[20rem] max-w-full overflow-hidden rounded-xl border border-[#dfe7e1] bg-[#f1f4f1]">
                {preview(chosen, true)}
                <span className="absolute left-3 top-3 rounded-full bg-[#ffffff]/90 px-3 py-1 text-xs font-bold text-[#244a37] shadow-sm backdrop-blur">
                  Look {chosenIdx + 1} of {shownStyles.length}
                </span>
                {chosen.generated_image_url && (
                  <button
                    type="button"
                    onClick={() => handleSaveStyle(chosen)}
                    disabled={saveState === 'saving' || saveState === 'saved'}
                    className={`absolute right-3 top-3 flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold shadow-md backdrop-blur transition-all cursor-pointer disabled:cursor-default ${
                      saveState === 'saved' ? 'bg-rose-500 text-[#ffffff]' : 'bg-[#ffffff]/90 text-[#33483c] hover:text-rose-600'
                    }`}
                  >
                    {saveState === 'saving'
                      ? <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
                      : <Heart aria-hidden="true" className={`size-4 ${saveState === 'saved' ? 'fill-current' : ''}`} />}
                    {saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Retry save' : 'Save'}
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-[#e4eee7] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2f5d46]">{chosen.category}</span>
                  {chosen.service && chosen.service !== 'Hair' && (
                    <span className="rounded-full bg-[#fdf3d7] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7a5a0c]">
                      {SERVICE_LABELS[chosen.service] || chosen.service}
                    </span>
                  )}
                  {(!chosen.service || chosen.service === 'Hair') && chosen.hair_length && (
                    <span className="text-[11px] font-medium text-[#7f968a]">· {chosen.hair_length}</span>
                  )}
                </div>
                <h3 className="text-xl font-bold leading-snug text-[#1a2a20]">{chosen.name}</h3>
                {chosen.feasibility_warning && chosen.feasible !== false && (
                  <p className="text-xs text-[#a3602c]">{chosen.feasibility_warning}</p>
                )}
                <p className="text-[13px] leading-relaxed text-[#6c7e73]">{chosen.description}</p>

                {chosen.chemical_addon && chosen.chemical_addon.required && (
                  <div className="flex items-center justify-between rounded-xl bg-[#fdf3d7] px-3 py-2 text-xs font-semibold text-[#7a5a0c]">
                    <span>Add-on: {chosen.chemical_addon.service_name}</span>
                    <span>+₹{chosen.chemical_addon.est_price_addon}</span>
                  </div>
                )}
                {chosen.stylist_instructions && (
                  <details className="rounded-xl border border-[#ebf0ec] px-3 py-1 text-xs">
                    <summary className="flex min-h-[32px] cursor-pointer items-center font-semibold text-[#2f5d46]">Haircut steps</summary>
                    <ol className="mb-2 mt-1 list-inside list-decimal space-y-0.5 text-[#6c7e73]">
                      {String(chosen.stylist_instructions).split('\n').filter((l: string) => l.trim()).map((l: string, i: number) => (
                        <li key={i}>{l.replace(/^\d+[.)]\s*/, '')}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>

              <button
                onClick={handleConfirmSelection}
                disabled={!canConfirm}
                title="Select a look whose preview is ready"
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${
                  canConfirm
                    ? 'bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-[#ffffff] shadow-lg shadow-[#244a37]/25 hover:from-[#1b392b] hover:to-[#244a37] active:scale-[0.98] cursor-pointer'
                    : 'cursor-not-allowed border border-[#e4eee7] bg-[#f1f4f1] text-[#a3b3a9]'
                }`}
              >
                {canConfirm ? <>Choose this look <ArrowRight aria-hidden="true" className="size-4" /></> : 'Wait for the preview to be ready'}
              </button>
            </div>
          )}

          {/* RIGHT: all looks as thumbnails */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#7f968a]">All looks · tap to view</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shownStyles.map((style, idx) => {
                const isSelected = selectedStyleId === style.style_id;
                return (
                  <div
                    key={style.style_id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedStyleId(style.style_id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedStyleId(style.style_id); } }}
                    className="group cursor-pointer focus-visible:outline-none"
                  >
                    <div className={`relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#f1f4f1] transition-all group-focus-visible:ring-4 group-focus-visible:ring-[#2f5d46]/25 ${
                      isSelected ? 'ring-[3px] ring-[#2f5d46] ring-offset-2' : 'ring-1 ring-[#dfe7e1] group-hover:ring-[#c3d3c9]'
                    }`}>
                      {preview(style, false)}
                      <span className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-[#ffffff]/90 text-[10px] font-bold text-[#244a37] shadow-sm">
                        {idx + 1}
                      </span>
                      {isSelected && (
                        <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-[#244a37] text-[#f3d27a] shadow">
                          <Check aria-hidden="true" className="size-3.5 stroke-[3]" />
                        </span>
                      )}
                      {saved[style.style_id] === 'saved' && (
                        <span className="absolute bottom-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-rose-500 text-[#ffffff]">
                          <Heart aria-hidden="true" className="size-3 fill-current" />
                        </span>
                      )}
                    </div>
                    <p className={`mt-1.5 truncate text-xs font-semibold ${isSelected ? 'text-[#1a2a20]' : 'text-[#4f6b5a]'}`}>{style.name}</p>
                    <p className="text-[10px] uppercase tracking-wide text-[#8a9a92]">{style.category}</p>
                  </div>
                );
              })}
            </div>

            <p className="flex items-start gap-2 rounded-xl bg-[#f6faf7] px-3 py-2.5 text-[11px] leading-relaxed text-[#6c7e73]">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#2f5d46]" />
              Previews are AI illustrations to help you choose. The real result depends on your hair and is agreed with your stylist; it is not a guarantee.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
