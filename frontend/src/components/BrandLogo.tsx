import React from 'react';
import { Scissors } from 'lucide-react';

/** Salon logo + name, shared by the customer header and the staff login header. */
export const BrandLogo: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <div className={`flex items-center space-x-2.5 ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center shadow-lg shadow-amber-500/20">
      <Scissors className="w-6 h-6 text-slate-950 font-bold" />
    </div>
    <div>
      <h1 className="font-bold text-lg leading-none tracking-tight text-white flex items-center gap-1.5">
        LUXE STYLING <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">AI</span>
      </h1>
      <p className="text-xs text-slate-400 font-medium">Smart Salon Personalization</p>
    </div>
  </div>
);
