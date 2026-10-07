import React from 'react';
import { Scissors, Sparkles, Palette, Wind, Hand, Flower2 } from 'lucide-react';

type IconProps = { className?: string };

/** Face with beard and moustache (no stock icon exists for beard grooming). */
const BeardIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M6.5 10V8.5a5.5 5.5 0 0 1 11 0V10" />
    <path d="M6.5 10c0 5.5 2.6 10 5.5 10s5.5-4.5 5.5-10" />
    <path d="M9 14.5c1.2-1 2.2-1 3 0 .8-1 1.8-1 3 0" />
    <path d="M9.5 10.5h.01M14.5 10.5h.01" />
  </svg>
);

const KINDS: { match: RegExp; icon: React.FC<IconProps>; tone: string; short: string }[] = [
  { match: /beard|shave|groom/i, icon: BeardIcon, tone: 'bg-orange-500/15 text-orange-300', short: 'Beard' },
  { match: /colou?r|balayage|highlight|henna/i, icon: Palette, tone: 'bg-fuchsia-500/15 text-fuchsia-300', short: 'Colour' },
  { match: /keratin|smooth|straighten|perm|rebond/i, icon: Wind, tone: 'bg-cyan-500/15 text-cyan-300', short: 'Smoothening' },
  { match: /facial|detox|clean-?up|bleach/i, icon: Sparkles, tone: 'bg-pink-500/15 text-pink-300', short: 'Facial' },
  { match: /manicure|pedicure|nail/i, icon: Hand, tone: 'bg-rose-500/15 text-rose-300', short: 'Nails' },
  { match: /spa|massage/i, icon: Flower2, tone: 'bg-emerald-500/15 text-emerald-300', short: 'Hair Spa' },
];
const HAIRCUT = { icon: Scissors as React.FC<IconProps>, tone: 'bg-amber-500/15 text-amber-300', short: 'Haircut' };

const kindOf = (name: string) => KINDS.find((k) => k.match.test(name)) || HAIRCUT;

/** Round icon bubble for a service, so the service is recognisable without reading English. */
export const ServiceIcon: React.FC<{ name: string; size?: 'sm' | 'md' | 'lg' }> = ({ name, size = 'md' }) => {
  const { icon: Icon, tone } = kindOf(name);
  const box = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-12 h-12' : 'w-9 h-9';
  const glyph = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';
  return (
    <span className={`${box} rounded-xl ${tone} flex items-center justify-center flex-shrink-0`} title={name}>
      <Icon className={glyph} />
    </span>
  );
};

/** Icon + short name chip, e.g. [scissors] Haircut. */
export const ServiceChip: React.FC<{ name: string; count?: number }> = ({ name, count }) => (
  <span className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-200" title={name}>
    <ServiceIcon name={name} size="sm" />
    <span className="font-semibold">{kindOf(name).short}</span>
    {count ? <span className="text-[10px] text-slate-400">{count}×</span> : null}
  </span>
);
