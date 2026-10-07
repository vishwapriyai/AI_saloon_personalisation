import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight, RefreshCw, ImageOff, Sparkles, Heart, AlertTriangle } from 'lucide-react';
import { saveSelection, generateStyleImages, generateSelectionViews, saveFavouriteStyle } from '../../api/client';
import { currentCustomerId } from '../../auth/session';

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
      const res = await generateStyleImages({ recommendation_id: recId, selected_style_ids: [styleId] });
      gen = res?.generations?.[0];
    } catch (err) {
      console.error(err);
      gen = { style_id: styleId, status: 'FAILED', generated_image_url: '', error: 'Preview generation failed. Please try again.' };
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

  return (
    <div className="flex-1 flex flex-col space-y-6 py-4">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-800/80 p-5 rounded-2xl border border-slate-700/60">
        <div>
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            STEP 3 OF 4: CHOOSE YOUR LOOK
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-1">Your Top {styles.length} Looks</h2>
          <p className="text-xs sm:text-sm text-slate-400">Your own photo with each recommended hairstyle. Tap to preview & select.</p>
        </div>

        <button
          onClick={handleConfirmSelection}
          disabled={!selectedStyleId || !styles.find((s) => s.style_id === selectedStyleId)?.generated_image_url}
          title="Select a look whose preview is ready"
          className="disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-6 py-3.5 rounded-2xl text-base shadow-sm active:scale-95 transition-all flex items-center justify-center space-x-2 touch-target-large"
        >
          <span>Confirm Selection</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Recommended styles: responsive touch grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {styles.map((style, idx) => {
          const isSelected = selectedStyleId === style.style_id;
          return (
            <div
              key={style.style_id}
              onClick={() => setSelectedStyleId(style.style_id)}
              className={`group relative bg-slate-800/60 border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 flex flex-col justify-between touch-target-large active:scale-[0.98] ${
                isSelected
                  ? 'border-amber-500 ring-2 ring-amber-500/40 shadow-sm bg-slate-800'
                  : 'border-slate-700/60 hover:border-slate-500'
              }`}
            >
              {/* Personalized preview: the customer's own edited photo only */}
              <div className="relative aspect-[4/5] bg-slate-950 overflow-hidden">
                {style.generated_image_url ? (
                  <img
                    src={style.generated_image_url}
                    alt={`You with ${style.name}`}
                    loading="lazy"
                    className="w-full h-full object-contain"
                  />
                ) : style.feasible === false && !retrying[style.style_id] ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 text-center bg-amber-500/5">
                    <AlertTriangle className="w-9 h-9 text-amber-400" />
                    <p className="text-sm font-semibold text-amber-200">Not suitable today</p>
                    <p className="text-[11px] text-slate-300 line-clamp-5">{style.feasibility_warning}</p>
                    {style.suggested_alternative && (
                      <p className="text-[11px] text-emerald-300">Try instead: <b>{style.suggested_alternative.name}</b></p>
                    )}
                    <p className="text-[10px] text-slate-500">No preview is made for a look the current hair cannot support.</p>
                  </div>
                ) : retrying[style.style_id] ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                    <Sparkles className="w-9 h-9 text-amber-400 animate-pulse" />
                    <p className="text-sm font-semibold text-slate-200">Creating your look...</p>
                    <p className="text-[11px] text-slate-400">This can take up to a couple of minutes.</p>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                    <ImageOff className="w-9 h-9 text-slate-500" />
                    <p className="text-sm font-semibold text-slate-200">Preview unavailable</p>
                    {style.generation_error && (
                      <p className="text-[11px] text-slate-400 line-clamp-5">{style.generation_error}</p>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRetry(style.style_id); }}
                      className="min-h-[44px] px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {style.generation_status === 'NOT_GENERATED' ? 'Create preview' : 'Retry'}
                    </button>
                  </div>
                )}

                <div className="absolute top-2 left-2 bg-slate-950/80 px-2 py-0.5 rounded-lg text-[11px] font-bold text-amber-400 border border-slate-700">
                  Option #{idx + 1}
                </div>

                {isSelected && (
                  <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-sm">
                    <Check className="w-5 h-5 stroke-[3]" />
                  </div>
                )}

                {style.generated_image_url && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleSaveStyle(style); }}
                    disabled={saved[style.style_id] === 'saving' || saved[style.style_id] === 'saved'}
                    className={`absolute bottom-2 right-2 min-h-[40px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm ${
                      saved[style.style_id] === 'saved' ? 'bg-rose-500 text-slate-950' : 'bg-slate-950/80 text-slate-100 border border-slate-600 hover:border-rose-400'
                    }`}
                    aria-label={`Save ${style.name}`}
                  >
                    {saved[style.style_id] === 'saving' ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Heart className={`w-4 h-4 ${saved[style.style_id] === 'saved' ? 'fill-current' : ''}`} />}
                    {saved[style.style_id] === 'saved' ? 'Saved' : saved[style.style_id] === 'error' ? 'Retry Save' : 'Save Style'}
                  </button>
                )}
              </div>

              {/* Style Information & Expert Analysis */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                        {style.category}
                      </span>
                      {style.service && style.service !== 'Hair' && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300 px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                          {SERVICE_LABELS[style.service] || style.service}
                        </span>
                      )}
                    </div>
                    {(!style.service || style.service === 'Hair') && style.hair_length && (
                      <span className="text-[11px] text-slate-400 font-medium">{style.hair_length}</span>
                    )}
                  </div>
                  <h3 className="font-bold text-white text-base leading-snug">{style.name}</h3>
                  {style.feasibility_warning && style.feasible !== false && (
                    <p className="text-[11px] text-amber-300 mt-1">{style.feasibility_warning}</p>
                  )}
                  <p className="text-xs text-slate-400 line-clamp-2 mt-1.5 leading-normal">{style.description}</p>
                  {style.preview_image_url && (
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <img
                        src={style.preview_image_url}
                        alt={`${style.name} style reference`}
                        loading="lazy"
                        className="w-11 h-11 rounded-lg object-cover border border-slate-700 shrink-0"
                      />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Style Reference</span>
                    </div>
                  )}
                </div>

                {/* Why it suits the customer + the stylist's cutting steps */}
                {style.expert_analysis && (
                  <div className="bg-slate-900/80 rounded-2xl p-2.5 border border-slate-700/60 text-[11px] space-y-1">
                    <p className="font-bold text-amber-400">Why it suits you</p>
                    <p className="line-clamp-3 text-slate-300">{style.expert_analysis.face_shape_rationale}</p>
                    {style.stylist_instructions && (
                      <details className="pt-1" onClick={(e) => e.stopPropagation()}>
                        <summary className="cursor-pointer font-semibold text-slate-300 min-h-[28px] flex items-center">Haircut steps</summary>
                        <ol className="mt-1 space-y-0.5 list-decimal list-inside text-slate-400">
                          {String(style.stylist_instructions).split('\n').filter((l: string) => l.trim()).map((l: string, i: number) => (
                            <li key={i}>{l.replace(/^\d+[.)]\s*/, '')}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {style.chemical_addon && style.chemical_addon.required && (
                      <div className="mt-1 pt-1 border-t border-slate-800 text-amber-400 font-semibold flex items-center justify-between">
                        <span>✨ Add-on: {style.chemical_addon.service_name}</span>
                        <span>+₹{style.chemical_addon.est_price_addon}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
};
