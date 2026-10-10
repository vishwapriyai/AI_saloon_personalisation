import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Volume2, CheckCircle, Square, AlertTriangle, ShieldCheck, Beaker, Languages, RefreshCw, Camera, Play } from 'lucide-react';
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

  return (
    <div className="flex-1 flex flex-col space-y-6 py-4">
      {/* Header Banner */}
      <div className="bg-slate-800/80 p-5 sm:p-6 rounded-2xl border border-slate-700/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            STEP 4 OF 4: STYLIST GUIDE
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-1">Stylist Cutting Instructions</h2>
          <p className="text-slate-400 text-xs sm:text-sm">Follow these steps for the chosen look.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {/* Language selector */}
          <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-700 rounded-2xl p-1" role="radiogroup" aria-label="Instruction language">
            <Languages className="w-4 h-4 text-slate-400 mx-2 flex-shrink-0" />
            {LANGUAGE_OPTIONS.map((l) => (
              <button key={l.code} role="radio" aria-checked={language === l.code} onClick={() => setLanguage(l.code)}
                className={`min-h-[44px] px-3 rounded-xl text-sm font-bold transition-all flex-1 sm:flex-none ${
                  language === l.code ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                }`}>
                {l.label}
              </button>
            ))}
          </div>

          {/* Audio instructions */}
          <button
            onClick={handleToggleAudio}
            disabled={audioLoading}
            className={`px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center space-x-2 transition-all shadow-sm touch-target-large active:scale-95 disabled:opacity-70 ${
              isPlayingAudio
                ? 'bg-rose-500 text-slate-950'
                : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
            }`}
          >
            {audioLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : isPlayingAudio ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            <span>{audioLoading ? 'Preparing Audio...' : isPlayingAudio ? 'Stop Audio' : 'Play Instructions'}</span>
            <Volume2 className="w-4 h-4 opacity-70" />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 -mt-3 px-1 flex items-center gap-1.5">
        <Volume2 className="w-3.5 h-3.5 text-amber-400" /> Language: <b className="text-slate-200">{languageName}</b> — the same steps are read aloud in this language.
      </p>

      {audioNote && (
        <div className="bg-slate-800/60 border border-slate-700 px-4 py-3 rounded-2xl text-xs text-slate-300">{audioNote}</div>
      )}

      {selectedStyle?.feasibility_warning && (
        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-center space-x-3 text-amber-300 text-xs sm:text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div>
            <span className="font-bold block">Physical Hair Feasibility Advisory:</span>
            <span>{selectedStyle.feasibility_warning}</span>
          </div>
        </div>
      )}

      {selectedStyle?.chemical_addon && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 p-4 rounded-2xl space-y-2 text-indigo-200 text-xs sm:text-sm">
          <div className="flex items-center space-x-2 text-indigo-400 font-bold">
            <Beaker className="w-5 h-5" />
            <span>Chemical Service Formula Required: {selectedStyle.chemical_addon.service_name}</span>
          </div>
          <p className="text-slate-300">{selectedStyle.chemical_addon.chemical_formula}</p>
        </div>
      )}

      {/* AI preview of the confirmed style: front, side, back */}
      <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="font-bold text-white text-base">{selectedStyle?.name || 'Personalized Hairstyle'} — AI Preview</h3>
            <p className="text-xs text-slate-400 mt-0.5">{selectedStyle?.category || 'Trendy'} • Maintenance: {selectedStyle?.maintenance_level || 'Medium'}</p>
          </div>
          <span className="text-[11px] text-slate-500">Generated on the customer's own photos</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {VIEWS.map(({ key, label }) => {
            const img = viewImage(key);
            const status = viewStatus(key);
            const hasError = comparison?.errors?.[key];
            return (
              <div key={key}>
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wide block mb-1">{label}</span>
                <div className="rounded-2xl overflow-hidden aspect-[4/5] bg-slate-950 border border-slate-700 flex flex-col items-center justify-center p-2 text-center">
                  {img ? (
                    <img src={img} alt={`${label} AI preview`} className="w-full h-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className={`w-5 h-5 ${status === 'Generating...' ? 'animate-spin text-amber-400' : 'text-slate-500'}`} />
                      <span className="text-[11px] text-slate-300 font-semibold">{hasError ? 'Preview Failed' : status}</span>
                      {hasError && <p className="text-[9px] text-slate-400 line-clamp-2">{hasError}</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {((comparison && (comparison.before.side || comparison.before.back) && (!comparison.ai.side || !comparison.ai.back)) || viewsTimedOut) && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleGenerateViews}
              disabled={generatingViews}
              className="min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-sm transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${generatingViews ? 'animate-spin' : ''}`} />
              {generatingViews ? 'Generating Side & Back Previews...' : 'Generate Side & Back Previews'}
            </button>
          </div>
        )}
      </div>

      {/* Step-by-Step Instructions List & Consultation Sign-off */}
      <div className="bg-slate-800/60 border border-slate-700/60 p-6 rounded-2xl flex flex-col justify-between space-y-6">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Scissors className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-lg">Execution Steps</h3>
              {stepsLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />}
            </div>
            <span className="text-xs text-slate-400">
              {completedSteps.length} of {instructions.length} completed
            </span>
          </div>

          <div className="space-y-3">
            {instructions.map((step: string, idx: number) => {
              const isDone = completedSteps.includes(idx);
              return (
                <div
                  key={idx}
                  onClick={() => toggleStep(idx)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start space-x-3 ${
                    isDone
                      ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200 opacity-80'
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-amber-500/50 text-slate-200'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-xl font-bold flex items-center justify-center text-xs flex-shrink-0 mt-0.5 ${
                    isDone ? 'bg-emerald-500 text-slate-950' : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    {isDone ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                  </div>
                  <p className={`text-sm font-medium leading-relaxed ${isDone ? 'line-through text-slate-400' : 'text-slate-200'}`}>
                    {step.replace(/^\d+\.\s*/, '')}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-slate-700/60">
          {!haircutConfirmed && selectionId ? (
            <>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-bold text-white">Confirm Haircut</span>
              </div>
              <p className="text-xs text-slate-400">Stylist and customer agree on this look and these steps. Confirm to start the service.</p>
              {confirmError && <p role="alert" className="text-xs text-rose-300">{confirmError}</p>}
              {needsStylist ? (
                <StaffApproval action="confirm the haircut and start the service" onApproved={(token) => handleConfirmHaircut(token)} />
              ) : (
                <button
                  onClick={() => handleConfirmHaircut()}
                  disabled={confirming}
                  className="w-full font-bold py-4 rounded-2xl text-base shadow-sm active:scale-95 transition-all flex items-center justify-center space-x-2 touch-target-large bg-emerald-600 hover:bg-emerald-700 text-slate-950 disabled:opacity-60"
                >
                  {confirming ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  <span>Confirm Haircut & Start Service</span>
                </button>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-bold text-white">{selectionId ? 'Haircut confirmed — after the haircut' : 'After the haircut'}</span>
              </div>
              <p className="text-xs text-slate-400">Capture the finished look (front, side, back) to compare it with the before photos and the AI preview.</p>
              <button
                onClick={() => { stopAudio(); navigate('/customer/confirmation'); }}
                className="w-full font-bold py-4 rounded-2xl text-base shadow-sm active:scale-95 transition-all flex items-center justify-center space-x-2 touch-target-large bg-amber-500 hover:bg-amber-600 text-slate-950"
              >
                <Camera className="w-5 h-5" />
                <span>Haircut Completed — Capture Post-Service Photos</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
