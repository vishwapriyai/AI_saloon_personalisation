import React from 'react';
import { Leaf } from 'lucide-react';
import { BRAND } from '../config/brand';

/** Salon logo + name, shared by the customer header and the staff login header. */
export const BrandLogo: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <div className={`flex items-center gap-2.5 ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
    <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center">
      <Leaf className="w-5 h-5 text-slate-950" />
    </div>
    <div>
      <h1 className="text-xl leading-none text-white">{BRAND.name}</h1>
      <p className="text-[11px] text-slate-400 font-semibold tracking-wide mt-0.5">{BRAND.tagline}</p>
    </div>
  </div>
);
