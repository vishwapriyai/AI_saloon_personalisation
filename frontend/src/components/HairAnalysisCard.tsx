import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ScanFace, Check, RefreshCw, Info, ChevronDown, AlertCircle } from 'lucide-react';
import { confirmPhotoAnalysis, type AnalysisField } from '../api/client';

const DENSITIES = ['Sparse / Bald', 'Fine', 'Medium', 'Thick'];
const LENGTHS = ['Bald', 'Buzz', 'Short', 'Medium', 'Long', 'Very Long'];  // Buzz = very short, not bald
const TEXTURES = ['Straight', 'Wavy', 'Curly', 'Coily'];
const FACE_SHAPES = ['Oval', 'Round', 'Square', 'Oblong', 'Heart', 'Diamond'];
const BEARDS = ['Clean Shaven', 'Stubble / Short Beard', 'Full Beard'];
const LABELS: Record<AnalysisField, string> = {
  hair_density: 'Hair density', hair_length: 'Hair length', hair_type: 'Hair texture',
  beard_style_current: 'Beard', beard_length_class: 'Beard length class', beard_pattern: 'Beard pattern', beard_zones: 'Beard zones', face_shape: 'Face shape',
};
const FLOW = ['Image', 'Face', 'Hair', 'Style'];

const readAnalysis = (): Record<string, any> | null => {
  try {
    return JSON.parse(localStorage.getItem('salon_photo_analysis') || 'null');
  } catch {
    return null;
  }
};

const known = (v: unknown) => (typeof v === 'string' && v && v !== 'Unknown' ? v : null);

/**
 * What the photo analysis found (face shape, hair length / texture / colour, hairline, current style, beard),
 * shown as a short summary; the details and manual corrections open on demand.
 */
export const HairAnalysisCard: React.FC<{ showBeard: boolean; onChange?: () => void }> = ({ showBeard, onChange }) => {
  const [analysis, setAnalysis] = useState<Record<string, any> | null>(readAnalysis);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const photoId = Number(localStorage.getItem('salon_photo_id') || 0);
  const photoUrl = localStorage.getItem('salon_original_image_url');
  if (!analysis || !photoId) return null;

  const update = async (field: AnalysisField, value: string) => {
    setSaving(field);
    setError(null);
    try {
      const res = await confirmPhotoAnalysis(photoId, { [field]: value });
      localStorage.setItem('salon_photo_analysis', JSON.stringify(res.facial_features));
      setAnalysis(res.facial_features);
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  };

  const isBald = analysis.hair_length === 'Bald' || analysis.hair_density === 'Sparse / Bald';

  const rows: { label: string; value: string | null; hint?: string }[] = [
    { label: 'Hairline', value: isBald ? 'Bald / High hairline' : known(analysis.hairline) },
    { label: 'Hair Colour', value: isBald ? 'None' : known(analysis.hair_color_detected) },
    { label: 'Current Hairstyle', value: isBald ? 'Bald / Clean Scalp' : (analysis.current_hairstyle || null) },
  ];

  const select = (field: AnalysisField, options: string[]) => {
    let detected = known(analysis[field]);
    if (field === 'hair_type' && (isBald || detected === 'None' || detected === 'Not Applicable (Bald)')) {
      detected = 'Not Applicable (Bald)';
    }
    const corrected = analysis[`${field}_source`] === 'stylist' || analysis[`${field}_source`] === 'customer';
    const value = detected || '';
    const fieldOptions = (field === 'hair_type' && isBald) ? ['Not Applicable (Bald)'] : options;

    return (
      <label className="flex items-center justify-between gap-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#4f6b5a]">
          {LABELS[field] || field}
          {saving === field
            ? <RefreshCw className="size-3 animate-spin text-[#7f968a]" />
            : corrected && <Check className="size-3 text-[#2f5d46]" />}
        </span>
        <select
          value={value}
          onChange={(e) => e.target.value && update(field, e.target.value)}
          disabled={saving === field || (field === 'hair_type' && isBald)}
          className="w-36 cursor-pointer rounded-lg border border-[#c3d3c9] bg-[#ffffff] px-2 py-1.5 text-xs font-semibold text-[#1a2a20] focus:border-[#2f5d46] focus:outline-none focus:ring-2 focus:ring-[#2f5d46]/15 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {!detected && <option value="">Choose</option>}
          {fieldOptions.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  };

  const needsConfirmation = Boolean(analysis.needs_confirmation || analysis.beard_length_class === 'Stubble (1-3mm)');
  const confirmBeard = needsConfirmation && showBeard;
  const confirmLength = analysis.hair_length_needs_confirmation && !['stylist', 'customer'].includes(analysis.hair_length_source);
  const toConfirm = (confirmBeard ? 1 : 0) + (confirmLength ? 1 : 0);

  if (showBeard) {
    const beardLengthClass = known(analysis.beard_length_class);
    const beardPattern = known(analysis.beard_pattern);
    if (beardLengthClass && beardLengthClass !== 'Clean-shaven') {
      rows.push({ label: 'Beard Length', value: beardLengthClass });
    }
    if (beardPattern && beardPattern !== 'None') {
      rows.push({ label: 'Beard Pattern', value: beardPattern });
    }
  }

  // Short summary shown when the panel is closed
  const summary = [
    known(analysis.face_shape) && `${analysis.face_shape} face`,
    known(analysis.hair_length) && (isBald ? 'Bald' : `${analysis.hair_length} hair`),
    !isBald && known(analysis.hair_type),
    showBeard && known(analysis.beard_style_current),
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-3.5 rounded-3xl border border-[#dfe7e1] bg-[#fafcfa] p-4">
      {photoUrl && (
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#eef3ee]">
          <img src={photoUrl} alt="Customer" className="h-full w-full object-cover object-center" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#1d3d2d]/85 to-transparent" />
          <ol aria-label="Analysis steps" className="absolute inset-x-3 bottom-3 flex items-center gap-1.5">
            {FLOW.map((step, i) => {
              const current = i === FLOW.length - 1;
              return (
                <React.Fragment key={step}>
                  <li className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
                    current ? 'bg-[#f3d27a] text-[#1d3d2d]' : 'bg-[#ffffff]/20 text-[#ffffff] backdrop-blur'
                  }`}>
                    {!current && <Check aria-hidden="true" className="size-3" />}
                    {step}
                  </li>
                  {i < FLOW.length - 1 && <span aria-hidden="true" className="h-px flex-1 bg-[#ffffff]/40" />}
                </React.Fragment>
              );
            })}
          </ol>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#1a2a20]">
          <ScanFace aria-hidden="true" className="size-4 text-[#2f5d46]" />
          Your analysis
        </h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-xs font-semibold text-[#2f5d46] hover:text-[#1d3d2d] cursor-pointer"
        >
          {open ? 'Done' : 'Edit details'}
          <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-1.5">
        {summary.map((s) => (
          <span key={s} className="rounded-full bg-[#e4eee7] px-2.5 py-1 text-[11px] font-semibold text-[#244a37]">{s}</span>
        ))}
      </div>

      {/* One small prompt instead of several notices */}
      {toConfirm > 0 && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-[#e9d9a8] bg-[#fdf8e8] px-3 py-2.5 text-left text-xs font-semibold text-[#6b5a22] transition-colors hover:bg-[#fbf1d4] cursor-pointer"
        >
          <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-[#8a6d12]" />
          <span className="flex-1">Please confirm {toConfirm === 1 ? '1 detail' : `${toConfirm} details`}</span>
          <ChevronDown aria-hidden="true" className="size-4 -rotate-90" />
        </button>
      )}

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
              {confirmBeard && (
                <p className="flex items-start gap-2 rounded-xl bg-[#fdf8e8] p-2.5 text-[11px] leading-relaxed text-[#6b5a22]">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#8a6d12]" />
                  Stubble (1-3mm) detected. Please confirm your current beard growth below.
                </p>
              )}
              {confirmLength && (
                <p className="flex items-start gap-2 rounded-xl bg-[#fdf8e8] p-2.5 text-[11px] leading-relaxed text-[#6b5a22]">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#8a6d12]" />
                  Please confirm the hair length ({known(analysis.hair_length) || 'not measured'}). A buzz cut and a bald scalp, or long hair tied back, can look alike in a photo.
                </p>
              )}

              {/* Editable values */}
              <div className="divide-y divide-[#ebf0ec]">
                {select('face_shape', FACE_SHAPES)}
                {select('hair_type', TEXTURES)}
                {select('hair_length', LENGTHS)}
                {select('hair_density', DENSITIES)}
                {showBeard && select('beard_style_current', BEARDS)}
              </div>

              {/* Detected values */}
              <dl className="space-y-1 rounded-xl bg-[#eef3ee] px-3 py-2">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[11px] text-[#6c7e73]">{r.label}</dt>
                    <dd className={`truncate text-right text-xs font-semibold ${r.value ? 'text-[#1a2a20]' : 'text-[#a3b3a9]'}`} title={r.value || r.hint}>
                      {r.value || 'Not measurable'}
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="text-[11px] leading-relaxed text-[#7f968a]">
                Measured from the photo. Hair density can't be seen in a photo, so please choose it, and correct anything the camera misread.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
};
