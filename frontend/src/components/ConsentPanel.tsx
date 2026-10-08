import React from 'react';
import type { ConsentChoices, ConsentState } from '../api/client';

interface Props {
  state: ConsentState | null;
  choices: ConsentChoices;
  onChange: (choices: ConsentChoices) => void;
  staff: boolean;
}

type Key = keyof ConsentChoices;

const ITEMS: { key: Key; required?: boolean; text: string }[] = [
  { key: 'consent_photo_analysis', required: true,
    text: 'My photos are analysed (face shape, hair length, texture and colour) to suggest hairstyles.' },
  { key: 'consent_third_party_ai', required: true,
    text: "To create the previews, my photos are sent to an external AI image service. They are used only to make my previews." },
  { key: 'consent_history_retention',
    text: 'Keep my photos and previews in my history for future visits. If not ticked, they are deleted the day after my visit.' },
  { key: 'consent_before_after_share',
    text: 'My chosen look may be shown on the page I share with friends (referral link).' },
  { key: 'consent_marketing', text: 'Send me offers by WhatsApp / SMS.' },
];

/** Consent under India's DPDP Act, recorded before photos are analysed. */
export const ConsentPanel: React.FC<Props> = ({ state, choices, onChange, staff }) => {
  const toggle = (key: Key) => onChange({ ...choices, [key]: !choices[key] });
  const minor = state?.is_minor;

  const allChecked = ITEMS.every(({ key }) => choices[key]) && (!minor || !staff || choices.is_minor_parental_consent);

  const toggleAll = () => {
    const next = !allChecked;
    onChange({
      consent_photo_analysis: next,
      consent_third_party_ai: next,
      consent_history_retention: next,
      consent_before_after_share: next,
      consent_marketing: next,
      is_minor_parental_consent: minor ? next : choices.is_minor_parental_consent,
    });
  };

  return (
    <fieldset className="bg-slate-900/90 p-4 sm:p-5 rounded-2xl border border-slate-700/80 space-y-4 text-left shadow-sm">
      <legend className="px-1 text-xs font-bold text-amber-400 uppercase tracking-wider">Photo & Privacy Consent</legend>

      {/* Master Toggle: Single tick box for all */}
      <label className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border-2 border-amber-500/50 text-xs font-bold text-amber-200 cursor-pointer transition-all shadow-sm">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
          className="w-5 h-5 rounded border-amber-400 accent-amber-500 cursor-pointer flex-shrink-0"
        />
        <span className="text-sm font-bold text-amber-300">Consent for all (Select All Terms)</span>
      </label>

      <div className="space-y-3 pt-1 border-t border-slate-700/60">
        {ITEMS.map(({ key, required, text }) => (
          <label key={key} className="flex items-start gap-3 text-xs text-slate-200 leading-relaxed cursor-pointer hover:text-white transition-colors">
            <input type="checkbox" checked={choices[key]} onChange={() => toggle(key)}
              className="mt-0.5 w-4 h-4 rounded border-slate-600 accent-amber-500 cursor-pointer flex-shrink-0" />
            <span>{text}{required && <b className="text-amber-400"> (required)</b>}</span>
          </label>
        ))}
      </div>

      {minor && (staff ? (
        <label className="flex items-start gap-3 text-xs text-slate-200 leading-relaxed cursor-pointer border-t border-slate-700 pt-3">
          <input type="checkbox" checked={choices.is_minor_parental_consent} onChange={() => toggle('is_minor_parental_consent')}
            className="mt-0.5 w-4 h-4 rounded border-slate-600 accent-amber-500 cursor-pointer flex-shrink-0" />
          <span>This is a child's profile. A parent or guardian is present and gives this consent on the child's behalf. <b className="text-amber-400">(required)</b></span>
        </label>
      ) : (
        <p className="text-xs text-amber-300 border-t border-slate-700 pt-3">
          This is a child's profile: a parent or guardian must give consent with the salon staff before photos are taken.
        </p>
      ))}
      <p className="text-[11px] text-slate-400">You can withdraw consent and delete your photos at any time from your profile.</p>
    </fieldset>
  );
};
