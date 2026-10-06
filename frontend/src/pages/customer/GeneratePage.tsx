import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Cpu } from 'lucide-react';

export const GeneratePage: React.FC = () => {
  const navigate = useNavigate();
  const [progress] = useState(0);
  const [total, setTotal] = useState(4);
  const [statusText, setStatusText] = useState('Analyzing your hair...');

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // Previews are created on the results page, card by card, so customers see each look as soon as it is
    // ready instead of waiting here for the slowest one. Safe to run twice (React StrictMode): it only sets
    // flags and schedules the redirect, and the cleanup cancels the first timer.
    const rawStyles = localStorage.getItem('salon_recommended_styles');
    setTotal(rawStyles ? JSON.parse(rawStyles).length : 0);
    setStatusText('Finding your best looks...');
    localStorage.removeItem('salon_generated_results');
    localStorage.setItem('salon_generation_pending', '1');
    const timer = setTimeout(() => { if (mounted.current) navigate('/customer/recommendations', { replace: true }); }, 600);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12">
      <div className="w-full bg-slate-800/80 border border-slate-700/60 rounded-3xl p-8 shadow-2xl text-center backdrop-blur-xl space-y-6">
        <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 animate-spin opacity-30 blur-md"></div>
          <div className="w-20 h-20 rounded-full bg-slate-900 border-2 border-amber-500/50 flex items-center justify-center text-amber-400 relative z-10 shadow-lg">
            <Sparkles className="w-10 h-10 animate-pulse" />
          </div>
        </div>

        <div>
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            AI IMAGE EDITING • YOUR OWN PHOTO
          </span>
          <h2 className="text-2xl font-bold text-white tracking-tight mt-3">Styling Your Photo in {total} Looks</h2>
          <p className="text-sm text-slate-400 mt-1">{statusText}</p>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>Generating Previews</span>
            <span className="text-amber-400">{progress} / {total} Completed</span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-3.5 p-0.5 border border-slate-700">
            <div
              className="bg-gradient-to-r from-amber-500 to-amber-400 h-full rounded-full transition-all duration-300 shadow-md shadow-amber-500/30"
              style={{ width: `${(progress / Math.max(total, 1)) * 100}%` }}
            ></div>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-center space-x-2 text-xs text-slate-500">
          <Cpu className="w-4 h-4 text-amber-500" />
          <span>Only your hairstyle changes. Each preview is checked to be the same person.</span>
        </div>
      </div>
    </div>
  );
};
