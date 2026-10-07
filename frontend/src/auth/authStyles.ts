// Shared look for the customer and staff login pages, so both stay identical in size and style.

export const authContainer = 'w-full';
export const authCard = 'bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-sm';
export const authIconBadge =
  'w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4';
export const authTitle = 'text-2xl sm:text-3xl font-bold text-white tracking-tight';
export const authSubtitle = 'text-slate-400 text-sm mt-1';
export const authLabel = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2';
export const authInput =
  'w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-4 pl-12 pr-4 text-base font-medium text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all touch-target-large';
export const authPasswordInput = authInput.replace('pr-4', 'pr-12'); // room for the show/hide icon
export const authFieldIcon = 'w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2';
export const authEyeButton = 'absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white';
export const authPrimaryButton =
  'w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-4 rounded-2xl text-lg shadow-sm active:scale-[0.98] transition-all flex items-center justify-center space-x-2 touch-target-large disabled:opacity-60';
export const authError = 'mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm font-medium';
export const authHint = 'text-[11px] text-slate-500 text-center';
export const authFooterLink = 'text-center text-xs text-slate-500 mt-5';
