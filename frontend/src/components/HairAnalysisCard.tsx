import React, { useState } from 'react';
import { ScanFace, Check, RefreshCw, ChevronRight, Info } from 'lucide-react';
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
const FLOW = ['Customer Image', 'Face Analysis', 'Hair Analysis', 'Style Recommendation'];

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
 * with optional manual override for hair density & length.
 */
export const HairAnalysisCard: React.FC<{ showBeard: boolean; onChange?: () => void }> = ({ showBeard, onChange }) => {
  const [analysis, setAnalysis] = useState<Record<string, any> | null>(readAnalysis);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{LABELS[field] || field}</p>
        <div className="flex items-center gap-2">
          <select
            value={value}
            onChange={(e) => e.target.value && update(field, e.target.value)}
            disabled={saving === field || (field === 'hair_type' && isBald)}
            aria-label={LABELS[field] || field}
            className="bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-white focus:outline-none focus:border-amber-500 max-w-full disabled:opacity-80 disabled:cursor-not-allowed"
          >
            {!detected && <option value="">Not measurable — choose</option>}
            {fieldOptions.map((o) => (
              <option key={o} value={o}>
                {o}{o === value ? (corrected ? ' (corrected)' : ' (detected)') : ''}
              </option>
            ))}
          </select>
          {saving === field ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" /> : corrected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
        </div>
      </div>
    );
  };

  const needsConfirmation = Boolean(analysis.needs_confirmation || analysis.beard_length_class === 'Stubble (1-3mm)');

  if (showBeard) {
    const beardLengthClass = known(analysis.beard_length_class);
    const beardPattern = known(analysis.beard_pattern);
    if (beardLengthClass && beardLengthClass !== 'Clean-shaven') {
      rows.push({ label: 'Beard Length Class', value: beardLengthClass });
    }
    if (beardPattern && beardPattern !== 'None') {
      rows.push({ label: 'Beard Pattern', value: beardPattern });
    }
  }

  return (
    <div className="bg-slate-800/70 border border-slate-700/60 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-300">
        {FLOW.map((step, i) => (
          <React.Fragment key={step}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />}
            <span className={i === FLOW.length - 1 
              ? 'text-amber-300 font-bold bg-amber-500/20 border border-amber-500/50 px-3 py-1 rounded-full shadow-sm' 
              : 'text-slate-200 font-semibold bg-slate-900 border border-slate-700 px-3 py-1 rounded-full'}>
              {step}
            </span>
          </React.Fragment>
        ))}
      </div>

      {needsConfirmation && showBeard && (
        <div className="bg-slate-900/95 border-2 border-amber-500/70 rounded-2xl p-4 flex items-start gap-3 shadow-md">
          <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-sm text-amber-300 tracking-wide">Stubble / Low Confidence Growth Detected</p>
            <p className="text-slate-100 text-xs font-medium leading-relaxed">
              Stubble (1-3mm) detected. Please confirm your current beard growth or adjust the beard class below before selecting beard styling services.
            </p>
          </div>
        </div>
      )}

      {analysis.hair_length_needs_confirmation && !['stylist', 'customer'].includes(analysis.hair_length_source) && (
        <div className="bg-slate-900/95 border border-amber-500/50 rounded-2xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-slate-100 text-xs font-medium leading-relaxed">
            Please confirm the hair length ({known(analysis.hair_length) || 'not measured'}). A very short buzz cut and a bald scalp,
            or long hair tied back, can look alike in a photo.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4 items-start">
        {photoUrl && (
          <div className="hidden md:block rounded-2xl overflow-hidden aspect-[4/5] bg-slate-950 border border-slate-700">
            <img src={photoUrl} alt="Customer" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="space-y-3">
          <h3 className="font-bold text-white flex items-center gap-2"><ScanFace className="w-5 h-5 text-amber-400" /> Face & Hair Analysis</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {rows.map((r) => (
              <div key={r.label} className="bg-slate-900/70 border border-slate-700/60 rounded-xl px-3 py-2 min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{r.label}</p>
                <p className={`text-sm font-semibold truncate ${r.value ? 'text-white' : 'text-slate-500'}`} title={r.value || r.hint}>{r.value || 'Not measurable'}</p>
              </div>
            ))}
            {select('face_shape', FACE_SHAPES)}
            {select('hair_type', TEXTURES)}
            {select('hair_length', LENGTHS)}
            {select('hair_density', DENSITIES)}
            {showBeard && select('beard_style_current', BEARDS)}
          </div>
          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
            Values are measured from the photo. Hair density cannot be seen in a photo, so please choose it. Correct anything the camera misread (for example a blond beard, or hair hidden under a cap) before choosing looks.
          </p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        </div>
      </div>
    </div>
  );
};
