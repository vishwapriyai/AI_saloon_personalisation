import React, { useState } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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

const checkbox = 'mt-0.5 size-4 shrink-0 rounded cursor-pointer accent-[#2f5d46]';

/** Consent under India's DPDP Act, recorded before photos are analysed. */
export const ConsentPanel: React.FC<Props> = ({ state, choices, onChange, staff }) => {
  const [open, setOpen] = useState(false);
  const toggle = (key: Key) => onChange({ ...choices, [key]: !choices[key] });
  const requiredAccepted = choices.consent_photo_analysis && choices.consent_third_party_ai;
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
    <fieldset className="space-y-3 rounded-2xl border border-[#dfe7e1] bg-[#fafcfa] p-4 text-left sm:p-5">
      <legend className="sr-only">Photo & Privacy Consent</legend>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#1a2a20]">
          <span className="grid size-7 place-items-center rounded-full bg-[#e4eee7] text-[#2f5d46]">
            <ShieldCheck aria-hidden="true" className="size-4" />
          </span>
          <h3 className="text-sm font-semibold">Photo &amp; privacy consent</h3>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          requiredAccepted ? 'bg-[#e4eee7] text-[#2f5d46]' : 'bg-[#fbeee0] text-[#a3602c]'
        }`}>
          {requiredAccepted ? 'Required accepted' : 'Action needed'}
        </span>
      </div>

      {/* Master toggle: one tick box for all */}
      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-semibold transition-colors ${
        allChecked
          ? 'border-[#2f5d46]/50 bg-[#e4eee7] text-[#1d3d2d]'
          : 'border-[#c3d3c9] bg-[#ffffff] text-[#1a2a20] hover:border-[#2f5d46]/60'
      }`}>
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="size-5 shrink-0 cursor-pointer rounded accent-[#2f5d46]" />
        <span>I agree to all of the below</span>
      </label>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#2f5d46] hover:text-[#1d3d2d] cursor-pointer"
      >
        {open ? 'Hide details' : 'Review each item'}
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
      {open && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden"
      >
      <div className="space-y-3 border-t border-[#ebf0ec] pt-3">
        {ITEMS.map(({ key, required, text }) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-[#4f5f54] transition-colors hover:text-[#1a2a20]">
            <input type="checkbox" checked={choices[key]} onChange={() => toggle(key)} className={checkbox} />
            <span>
              {text}
              {required && (
                <span className="ml-1.5 rounded-full bg-[#fbeee0] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#a3602c]">Required</span>
              )}
            </span>
          </label>
        ))}
      </div>

      </motion.div>
      )}
      </AnimatePresence>

      {minor && (staff ? (
        <label className="flex cursor-pointer items-start gap-3 border-t border-[#ebf0ec] pt-3 text-xs leading-relaxed text-[#4f5f54]">
          <input type="checkbox" checked={choices.is_minor_parental_consent} onChange={() => toggle('is_minor_parental_consent')} className={checkbox} />
          <span>
            This is a child's profile. A parent or guardian is present and gives this consent on the child's behalf.
            <span className="ml-1.5 rounded-full bg-[#fbeee0] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#a3602c]">Required</span>
          </span>
        </label>
      ) : (
        <p className="border-t border-[#ebf0ec] pt-3 text-xs font-medium text-[#a3602c]">
          This is a child's profile: a parent or guardian must give consent with the salon staff before photos are taken.
        </p>
      ))}
      <p className="text-[11px] text-[#7f968a]">You can withdraw consent and delete your photos at any time from your profile.</p>
    </fieldset>
  );
};
