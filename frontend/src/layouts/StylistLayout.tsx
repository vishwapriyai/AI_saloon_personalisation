import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Scissors, ArrowLeft } from 'lucide-react';

export const StylistLayout: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate('/stylist')}
            className="p-2 rounded-xl bg-slate-800 text-slate-300"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <Scissors className="w-6 h-6 text-amber-400" />
            <h1 className="font-bold text-white tracking-wide">STYLIST WORKSTATION</h1>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Station #4 Active</span>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
};
