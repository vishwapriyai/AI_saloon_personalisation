import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Volume2, CheckCircle, Square, AlertTriangle, ShieldCheck, Beaker, RefreshCw, Camera, Play, Check } from 'lucide-react';
import { getInstructions, getInstructionAudio, getSelectionComparison, generateSelectionViews, confirmHaircut } from '../../api/client';
import type { InstructionLanguage, PhotoView, SelectionComparison } from '../../api/client';
import { getSession, isStaff } from '../../auth/session';
import { StaffApproval } from '../../components/StaffApproval';

const LANGUAGE_OPTIONS: { code: InstructionLanguage; label: string; speech: string }[] = [
  { code: 'en', label: 'English', speech: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', speech: 'hi-IN' },
  { code: 'ta', label: 'தமிழ்', speech: 'ta-IN' },
];
const VIEWS: { key: PhotoView; label: string }[] = [
  { key: 'front', label: 'Front' }, { key: 'side', label: 'Side' }, { key: 'back', label: 'Back' },
];

const STEPS = ['Photos', 'Preferences', 'Your look', 'Stylist guide'];

const storedLanguage = (): InstructionLanguage => {
  const v = localStorage.getItem('salon_audio_language');
  return v === 'hi' || v === 'ta' ? v : 'en';
};

export const CuttingInstructionsPage: React.FC = () => {
  const navigate = useNavigate();
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [language, setLanguage] = useState<InstructionLanguage>(storedLanguage);
  const [translatedSteps, setTranslatedSteps] = useState<string[] | null>(null);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [comparison, setComparison] = useState<SelectionComparison | null>(null);
  const [viewsTimedOut, setViewsTimedOut] = useState(false);
  const [generatingViews, setGeneratingViews] = useState(false);
  const [haircutConfirmed, setHaircutConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<PhotoView>('front');
  // Confirming the haircut is a stylist's action: on a customer's own session a stylist signs in for it
  const needsStylist = !isStaff(getSession());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const triggeredRef = useRef(false);

  const rawSelectedStyle = localStorage.getItem('salon_selected_style');
  const selectedStyle = rawSelectedStyle ? JSON.parse(rawSelectedStyle) : null;
  const styleId: number | null = selectedStyle?.style_id || selectedStyle?.id || null;
  const selectionId = Number(localStorage.getItem('salon_selection_id') || 0);

  const defaultInstructions = [
    '1. Trim the sides with #1.5 guard to establish clean taper fade.',
    '2. Maintain 2.5 inches length on top for natural volume.',
    '3. Create point-cut texture layering along the crown.',
    '4. Shape the front fringe hairline according to customer reference photo.',
    '5. Finish sideburns and neckline with razor precision sharpness.'
  ];

  const englishSteps: string[] = selectedStyle?.stylist_instructions
    ? selectedStyle.stylist_instructions.split('\n').filter((s: string) => s.trim())
    : defaultInstructions;
  const instructions = translatedSteps && translatedSteps.length ? translatedSteps : englishSteps;

  const stopAudio = () => {
    audioRef.current?.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsPlayingAudio(false);
  };

  // Steps in the chosen language, with this customer's notes (hair texture, density, hairline, face shape)
  useEffect(() => {
    localStorage.setItem('salon_audio_language', language);
    stopAudio();
    setAudioNote(null);
    if (!styleId) { setTranslatedSteps(null); return; }
    let cancelled = false;
    setStepsLoading(true);
    getInstructions(styleId, language, selectionId)
      .then((r) => {
        if (cancelled) return;
        setTranslatedSteps(r.steps);
        if (!r.translated && language !== 'en') setAudioNote('Translation is unavailable right now, so the steps are shown in English.');
      })
      .catch(() => {
        if (cancelled) return;
        setTranslatedSteps(null);
        if (language !== 'en') setAudioNote('Translation is unavailable right now, so the steps are shown in English.');
      })
      .finally(() => { if (!cancelled) setStepsLoading(false); });
    return () => { cancelled = true; };
  }, [language, styleId, selectionId]);

  const handleGenerateViews = async () => {
    if (!selectionId || generatingViews) return;
    setGeneratingViews(true);
    setViewsTimedOut(false);
    try {
      const res = await generateSelectionViews(selectionId);
      setComparison(res);
    } catch (e) {
      console.error('View generation failed:', e);
    } finally {
      setGeneratingViews(false);
    }
  };

  // AI previews for side and back are generated in the background after confirmation: poll until ready
  useEffect(() => {
    if (!selectionId) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const c = await getSelectionComparison(selectionId);
        if (cancelled) return;
        setComparison(c);
        if (c.haircut_confirmed) setHaircutConfirmed(true);
        const wanted: PhotoView[] = c.style.service === 'Beard' ? ['side'] : ['side', 'back'];
        const pending = wanted.filter((v) => c.before[v] && !c.ai[v]);
        if (!pending.length) return;

        // If side/back photos exist but AI views are missing and no generation triggered yet, start generation
        if (!triggeredRef.current && pending.length > 0) {
          triggeredRef.current = true;
          handleGenerateViews();
        }
      } catch { /* keep trying */ }
      tries += 1;
      if (tries >= 40) { setViewsTimedOut(true); return; } // ~5 minutes
      timer = setTimeout(poll, 6000);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectionId]);

  useEffect(() => () => {
    stopAudio();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const toggleStep = (idx: number) => {
    setCompletedSteps(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const speakWithBrowser = () => {
    if (!('speechSynthesis' in window)) { setAudioNote('Audio is not supported on this browser.'); return; }
    const text = `${selectedStyle?.name || 'Selected Hairstyle'}. ` + instructions.map((s) => s.replace(/^\d+\.\s*/, '')).join('. ');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANGUAGE_OPTIONS.find((l) => l.code === language)?.speech || 'en-IN';
    utterance.rate = 0.95;
    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);
    window.speechSynthesis.speak(utterance);
    setIsPlayingAudio(true);
  };

  const handleToggleAudio = async () => {
    if (isPlayingAudio) { stopAudio(); return; }
    if (!styleId) { speakWithBrowser(); return; }
    setAudioLoading(true);
    try {
      const { url, language: used } = await getInstructionAudio(styleId, language, selectionId);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => setIsPlayingAudio(false);
      audioRef.current = audio;
      await audio.play();
      setIsPlayingAudio(true);
      setAudioNote(used !== language ? 'Translated audio is unavailable right now, so it is playing in English.' : null);
    } catch {
      // Server voice unavailable (offline): use the device voice instead
      speakWithBrowser();
    } finally {
      setAudioLoading(false);
    }
  };

  const handleConfirmHaircut = async (staffToken?: string) => {
    if (!selectionId) { navigate('/customer/confirmation'); return; }
    setConfirming(true);
    setConfirmError(null);
    try {
      await confirmHaircut(selectionId, language, staffToken);
      setHaircutConfirmed(true);
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Could not confirm the haircut');
    } finally {
      setConfirming(false);
    }
  };

  const languageName = LANGUAGE_OPTIONS.find((l) => l.code === language)?.label;
  const frontPreview = comparison?.ai.front || selectedStyle?.generated_image_url || null;
  const viewImage = (v: PhotoView) => (v === 'front' ? frontPreview : comparison?.ai[v] || null);
  const viewStatus = (v: PhotoView) => {
    if (v === 'front') return frontPreview ? null : 'No preview';
    if (!comparison) return selectionId ? 'Loading...' : 'Not available';
    const isBeardOrBald = comparison.style.service === 'Beard' || comparison.style.hair_length === 'Bald';
    if (v === 'back' && isBeardOrBald) return 'Not needed for beard / bald scalp';
    if (!comparison.before[v]) return 'No photo captured';
    return viewsTimedOut ? 'Preview unavailable' : 'Generating...';
  };

  const doneCount = completedSteps.length;
  const progress = instructions.length ? Math.round((doneCount / instructions.length) * 100) : 0;
  const activeImg = viewImage(activeView);
  const activeStatus = viewStatus(activeView);
  const activeError = comparison?.errors?.[activeView];
  const showGenerate = (comparison && (comparison.before.side || comparison.before.back) && (!comparison.ai.side || !comparison.ai.back)) || viewsTimedOut;

  return (
    <div className="auth-rise flex-1 py-2 sm:py-4">
      <div className="w-full overflow-clip rounded-3xl border border-[#dfe7e1] bg-[#ffffff] shadow-[0_24px_60px_-30px_rgba(36,74,55,0.35)]">
        {/* Header band */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-5 sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">Step 4 of 4</p>
              <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-[#ffffff]">Stylist guide</h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[#ffffff]/75">
                {selectedStyle?.name || 'Personalized hairstyle'} · {selectedStyle?.category || 'Trendy'} · Maintenance: {selectedStyle?.maintenance_level || 'Medium'}
              </p>
            </div>
            <div className="hidden shrink-0 rounded-2xl bg-[#ffffff]/10 px-4 py-2.5 text-right ring-1 ring-[#ffffff]/10 sm:block">
              <p className="text-sm font-semibold text-[#ffffff]">{doneCount} of {instructions.length} steps</p>
              <p className="mt-0.5 text-xs text-[#ffffff]/65">{haircutConfirmed ? 'Haircut confirmed' : 'Not confirmed yet'}</p>
            </div>
          </div>

          <ol aria-label="Progress, step 4 of 4" className="relative mt-4 hidden items-center gap-2 sm:flex">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <li className="flex items-center gap-2" aria-current={i === 3 ? 'step' : undefined}>
                  <span className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
                    i === 3 ? 'bg-[#f3d27a] text-[#1d3d2d]' : 'bg-[#ffffff]/90 text-[#1d3d2d]'
                  }`}>
                    {i < 3 ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
                  </span>
                  <span className={`text-xs ${i === 3 ? 'font-semibold text-[#ffffff]' : 'text-[#ffffff]/85'}`}>{label}</span>
                </li>
                {i < STEPS.length - 1 && <span className="h-px min-w-3 flex-1 bg-[#ffffff]/50" />}
              </React.Fragment>
            ))}
          </ol>
        </div>

        <div className="grid items-start gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* LEFT: AI preview, front / side / back */}
          <div className="flex flex-col gap-3 lg:sticky lg:top-24">
            <div className="relative mx-auto aspect-[4/5] h-[min(30rem,calc(100vh-19rem))] min-h-[18rem] max-w-full overflow-hidden rounded-xl border border-[#dfe7e1] bg-[#f1f4f1]">
              {activeImg ? (
                <img src={activeImg} alt={`${activeView} AI preview`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-4 text-center">
                  <RefreshCw aria-hidden="true" className={`size-7 ${activeStatus === 'Generating...' ? 'animate-spin text-[#c9971f]' : 'text-[#a3b3a9]'}`} />
                  <p className="text-sm font-semibold text-[#33483c]">{activeError ? 'Preview failed' : activeStatus}</p>
                  {activeError && <p className="line-clamp-3 max-w-xs text-xs text-[#6c7e73]">{activeError}</p>}
                </div>
              )}
              <span className="absolute left-3 top-3 rounded-full bg-[#ffffff]/90 px-3 py-1 text-xs font-bold capitalize text-[#244a37] shadow-sm backdrop-blur">
                {activeView} · AI preview
              </span>
            </div>

            <div role="tablist" aria-label="Preview views" className="grid grid-cols-3 gap-2">
              {VIEWS.map(({ key, label }) => {
                const img = viewImage(key);
                const selected = key === activeView;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveView(key)}
                    className={`flex items-center gap-2 rounded-xl border p-1.5 text-left transition-all cursor-pointer ${
                      selected ? 'border-[#2f5d46] bg-[#f2f8f4] shadow-sm' : 'border-[#dfe7e1] bg-[#ffffff] hover:border-[#c3d3c9]'
                    }`}
                  >
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#eef3ee]">
                      {img
                        ? <img src={img} alt="" className="h-full w-full object-cover" />
                        : <RefreshCw aria-hidden="true" className={`size-4 ${viewStatus(key) === 'Generating...' ? 'animate-spin text-[#c9971f]' : 'text-[#a3b3a9]'}`} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[#1a2a20]">{label}</span>
                      <span className="block truncate text-[10px] text-[#7f968a]">{img ? 'Ready' : viewStatus(key)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {showGenerate && (
              <button
                type="button"
                onClick={handleGenerateViews}
                disabled={generatingViews}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#c3d3c9] bg-[#ffffff] text-xs font-semibold text-[#2f5d46] transition-all hover:border-[#2f5d46] hover:bg-[#f6faf7] disabled:opacity-70 cursor-pointer"
              >
                <RefreshCw aria-hidden="true" className={`size-4 ${generatingViews ? 'animate-spin' : ''}`} />
                {generatingViews ? 'Generating side & back previews…' : 'Generate side & back previews'}
              </button>
            )}
            <p className="text-center text-[11px] text-[#8a9a92]">Generated on the customer's own photos</p>
          </div>

          {/* RIGHT: audio, advisories, steps, confirm */}
          <div className="flex min-w-0 flex-col gap-5">
            {/* Listen: compact audio player */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-3 sm:flex-nowrap">
                <button
                  onClick={handleToggleAudio}
                  disabled={audioLoading}
                  aria-label={isPlayingAudio ? 'Stop audio' : `Play steps in ${languageName}`}
                  className={`grid size-12 shrink-0 place-items-center rounded-full text-[#ffffff] shadow-md transition-all active:scale-95 disabled:opacity-70 cursor-pointer ${
                    isPlayingAudio ? 'bg-rose-600 shadow-rose-600/25 hover:bg-rose-700' : 'bg-gradient-to-br from-[#244a37] to-[#2f5d46] shadow-[#244a37]/25 hover:from-[#1b392b]'
                  }`}
                >
                  {audioLoading
                    ? <RefreshCw aria-hidden="true" className="size-5 animate-spin" />
                    : isPlayingAudio
                      ? <Square aria-hidden="true" className="size-4 fill-current" />
                      : <Play aria-hidden="true" className="ml-0.5 size-5 fill-current" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#1a2a20]">
                    {audioLoading ? 'Preparing audio…' : isPlayingAudio ? 'Playing the steps' : 'Listen to the steps'}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-[#6c7e73]">
                    {isPlayingAudio ? (
                      <span aria-hidden="true" className="flex h-3 items-end gap-0.5">
                        {[0, 1, 2, 3].map((i) => (
                          <span key={i} className="w-0.5 animate-pulse rounded-full bg-[#2f5d46]" style={{ height: `${[6, 12, 8, 10][i]}px`, animationDelay: `${i * 150}ms` }} />
                        ))}
                      </span>
                    ) : (
                      <Volume2 aria-hidden="true" className="size-3.5" />
                    )}
                    Read aloud in {languageName}
                  </p>
                </div>

                <div role="radiogroup" aria-label="Instruction language" className="flex shrink-0 items-center gap-0.5 rounded-full bg-[#eef3ee] p-1">
                  {LANGUAGE_OPTIONS.map((l) => {
                    const on = language === l.code;
                    return (
                      <button
                        key={l.code}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setLanguage(l.code)}
                        className={`h-8 rounded-full px-3 text-xs font-semibold transition-all cursor-pointer ${
                          on ? 'bg-[#ffffff] text-[#1a2a20] shadow-sm' : 'text-[#4f6b5a] hover:text-[#1a2a20]'
                        }`}
                      >
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {audioNote && <p className="px-1 text-[11px] text-[#a3602c]">{audioNote}</p>}
            </div>

            {selectedStyle?.feasibility_warning && (
              <div className="flex items-start gap-3 rounded-2xl border border-[#e9d9a8] bg-[#fdf8e8] p-4">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[#a3602c]" />
                <div className="space-y-0.5 text-xs">
                  <p className="font-bold text-[#4d3f0f]">Hair feasibility advisory</p>
                  <p className="leading-relaxed text-[#6b5a22]">{selectedStyle.feasibility_warning}</p>
                </div>
              </div>
            )}

            {selectedStyle?.chemical_addon && (
              <div className="flex items-start gap-3 rounded-2xl border border-[#d9d4ee] bg-[#f5f3fc] p-4">
                <Beaker aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[#5b4fa0]" />
                <div className="space-y-0.5 text-xs">
                  <p className="font-bold text-[#3d3470]">Chemical service: {selectedStyle.chemical_addon.service_name}</p>
                  <p className="leading-relaxed text-[#5a5480]">{selectedStyle.chemical_addon.chemical_formula}</p>
                </div>
              </div>
            )}

            {/* Steps */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#1a2a20]">
                  <Scissors aria-hidden="true" className="size-4 text-[#2f5d46]" /> Cutting steps
                  {stepsLoading && <RefreshCw aria-hidden="true" className="size-3.5 animate-spin text-[#7f968a]" />}
                </h3>
                <span className="text-xs font-semibold text-[#6c7e73]">{doneCount} of {instructions.length} done</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#e4eee7]">
                <div className="h-full rounded-full bg-gradient-to-r from-[#244a37] to-[#3a6b52] transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>

              <ol className="divide-y divide-[#ebf0ec] overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff]">
                {instructions.map((step: string, idx: number) => {
                  const isDone = completedSteps.includes(idx);
                  return (
                    <li key={idx}>
                      <label className="flex cursor-pointer items-start gap-3.5 px-4 py-3.5 transition-colors hover:bg-[#f6faf7]">
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => toggleStep(idx)}
                          className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-[#2f5d46]"
                        />
                        <span className={`flex-1 text-sm leading-relaxed ${isDone ? 'text-[#8a9a92]' : 'text-[#1a2a20]'}`}>
                          {step.replace(/^\d+\.\s*/, '')}
                        </span>
                        <span className="pt-0.5 text-[11px] font-semibold text-[#a3b3a9]">{idx + 1}</span>
                      </label>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Confirm / after the haircut */}
            <div className="space-y-3 rounded-2xl border border-[#dfe7e1] bg-[#fafcfa] p-4">
              {!haircutConfirmed && selectionId ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-bold text-[#1a2a20]">
                    <ShieldCheck aria-hidden="true" className="size-4 text-[#2f5d46]" /> Confirm haircut
                  </p>
                  <p className="text-xs text-[#6c7e73]">Stylist and customer agree on this look and these steps. Confirm to start the service.</p>
                  {confirmError && <p role="alert" className="text-xs text-rose-700">{confirmError}</p>}
                  {needsStylist ? (
                    <StaffApproval action="confirm the haircut and start the service" onApproved={(token) => handleConfirmHaircut(token)} />
                  ) : (
                    <button
                      onClick={() => handleConfirmHaircut()}
                      disabled={confirming}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-sm font-semibold text-[#ffffff] shadow-lg shadow-[#244a37]/25 transition-all hover:from-[#1b392b] hover:to-[#244a37] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                    >
                      {confirming ? <RefreshCw className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
                      <span>Confirm haircut &amp; start service</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm font-bold text-[#1a2a20]">
                    <CheckCircle aria-hidden="true" className="size-4 text-[#2f5d46]" />
                    {selectionId ? 'Haircut confirmed — after the haircut' : 'After the haircut'}
                  </p>
                  <p className="text-xs text-[#6c7e73]">Capture the finished look (front, side, back) to compare it with the before photos and the AI preview.</p>
                  <button
                    onClick={() => { stopAudio(); navigate('/customer/confirmation'); }}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c9971f] text-sm font-semibold text-[#ffffff] shadow-lg shadow-[#c9971f]/25 transition-all hover:bg-[#b3851a] active:scale-[0.98] cursor-pointer"
                  >
                    <Camera aria-hidden="true" className="size-4" />
                    <span>Haircut done — capture after photos</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
