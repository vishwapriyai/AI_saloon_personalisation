import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Volume2, CheckCircle, Square, AlertTriangle, ShieldCheck, Beaker } from 'lucide-react';

export const CuttingInstructionsPage: React.FC = () => {
  const navigate = useNavigate();
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [stylistApproved, setStylistApproved] = useState(false);


  const rawSelectedStyle = localStorage.getItem('salon_selected_style');
  const selectedStyle = rawSelectedStyle ? JSON.parse(rawSelectedStyle) : null;

  const defaultInstructions = [
    '1. Trim the sides with #1.5 guard to establish clean taper fade.',
    '2. Maintain 2.5 inches length on top for natural volume.',
    '3. Create point-cut texture layering along the crown.',
    '4. Shape the front fringe hairline according to customer reference photo.',
    '5. Finish sideburns and neckline with razor precision sharpness.'
  ];

  const instructions = selectedStyle?.stylist_instructions
    ? selectedStyle.stylist_instructions.split('\n').filter((s: string) => s.trim())
    : defaultInstructions;

  const toggleStep = (idx: number) => {
    setCompletedSteps(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleToggleSpeechAudio = () => {
    if ('speechSynthesis' in window) {
      if (isPlayingAudio) {
        window.speechSynthesis.cancel();
        setIsPlayingAudio(false);
      } else {
        const text = `Haircut cutting instructions for ${selectedStyle?.name || 'Selected Hairstyle'}. ` + instructions.join('. ');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.onend = () => setIsPlayingAudio(false);
        utterance.onerror = () => setIsPlayingAudio(false);
        window.speechSynthesis.speak(utterance);
        setIsPlayingAudio(true);
      }
    } else {
      alert('Voice synthesis audio is supported on this browser.');
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-6 py-4">
      {/* Header Banner */}
      <div className="bg-slate-800/80 p-5 sm:p-6 rounded-3xl border border-slate-700/60 backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            STEP 4 OF 4: STYLIST GUIDE
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-1">Stylist Cutting Instructions</h2>
          <p className="text-slate-400 text-xs sm:text-sm">Step-by-step guidance derived from selected hairstyle metadata.</p>
        </div>

        {/* Audio Speech Synthesis Button for Stylist */}
        <button
          onClick={handleToggleSpeechAudio}
          className={`px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center space-x-2 transition-all shadow-lg touch-target-large active:scale-95 ${
            isPlayingAudio
              ? 'bg-rose-500 text-white shadow-rose-500/20 animate-pulse'
              : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
          }`}
        >
          {isPlayingAudio ? <Square className="w-5 h-5 fill-current" /> : <Volume2 className="w-5 h-5" />}
          <span>{isPlayingAudio ? 'Pause Audio Instructions' : 'Listen Audio Instructions'}</span>
        </button>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Reference Images (Front, Side, Back) */}
        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl space-y-4">
          <h3 className="font-bold text-white text-base">Catalogue Multi-Angle Views</h3>
          
          <div className="space-y-3">
            <div>
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wide block mb-1">
                {selectedStyle?.generated_image_url ? 'Your Personalized Preview' : 'Style Reference (catalogue photo)'}
              </span>
              <div className="rounded-2xl overflow-hidden aspect-[4/5] bg-slate-950 border border-slate-700">
                <img
                  src={selectedStyle?.generated_image_url || selectedStyle?.preview_image_url || ''}
                  alt={selectedStyle?.generated_image_url ? 'Customer with selected hairstyle' : 'Style reference'}
                  className={`w-full h-full ${selectedStyle?.generated_image_url ? 'object-contain' : 'object-cover'}`}
                />
              </div>
            </div>

            {selectedStyle?.side_image_url && (
              <div>
                <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wide block mb-1">Side / Taper Angle</span>
                <div className="rounded-2xl overflow-hidden aspect-[4/3] bg-slate-950 border border-slate-700">
                  <img src={selectedStyle.side_image_url} alt="Side Angle" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-bold text-amber-400 text-lg">{selectedStyle?.name || 'Personalized Hairstyle'}</h4>
            <p className="text-xs text-slate-400 mt-1">{selectedStyle?.category || 'Trendy'} • Maintenance: {selectedStyle?.maintenance_level || 'Medium'}</p>
          </div>

        </div>

        {/* Right Column: Step-by-Step Instructions List & Consultation Sign-off */}
        <div className="lg:col-span-2 bg-slate-800/60 border border-slate-700/60 p-6 rounded-3xl flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Scissors className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-lg">Execution Steps</h3>
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
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-bold text-white">Stylist In-Person Consultation Approval</span>
            </div>

            <button
              onClick={() => {
                setStylistApproved(!stylistApproved);
                navigate('/customer/confirmation');
              }}
              className={`w-full font-bold py-4 rounded-2xl text-base shadow-lg active:scale-95 transition-all flex items-center justify-center space-x-2 touch-target-large ${
                stylistApproved
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-amber-500/20'
              }`}
            >
              <CheckCircle className="w-5 h-5" />
              <span>{stylistApproved ? 'Service Confirmed & Verified' : 'Confirm Stylist Approval & Complete Service'}</span>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
};


