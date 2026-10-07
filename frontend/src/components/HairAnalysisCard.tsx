import React, { useState } from 'react';
import { ScanFace, Check, RefreshCw, ChevronRight, Info } from 'lucide-react';
import { confirmPhotoAnalysis } from '../api/client';

const DENSITIES = ['Sparse / Bald', 'Fine', 'Medium', 'Thick'];
const LENGTHS = ['Bald', 'Short', 'Medium', 'Long', 'Very Long'];
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
export const HairAnalysisCard: React.FC<{ showBeard: boolean }> = ({ showBeard }) => {
  const [analysis, setAnalysis] = useState<Record<string, any> | null>(readAnalysis);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photoId = Number(localStorage.getItem('salon_photo_id') || 0);
  const photoUrl = localStorage.getItem('salon_original_image_url');
  if (!analysis || !photoId) return null;

  const update = async (field: 'hair_density' | 'hair_length', value: string) => {
    setSaving(field);
    setError(null);
    try {
      const res = await confirmPhotoAnalysis(photoId, { [field]: value });
      localStorage.setItem('salon_photo_analysis', JSON.stringify(res.facial_features));
      setAnalysis(res.facial_features);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  };

  const rows: { label: string; value: string | null; hint?: string }[] = [
    { label: 'Face Shape', value: known(analysis.face_shape), hint: 'Turn to face the camera straight for a reading' },
    { label: 'Hair Texture', value: known(analysis.hair_type) },
    { label: 'Hairline', value: known(analysis.hairline) },
    { label: 'Hair Colour', value: known(analysis.hair_color_detected) },
    { label: 'Current Hairstyle', value: analysis.current_hairstyle || null },
    ...(showBeard ? [{ label: 'Beard', value: known(analysis.beard_style_current) }] : []),
  ];
  const density = known(analysis.hair_density) || 'Auto (From Photo)';
  const length = known(analysis.hair_length) || 'Auto (From Photo)';

  const select = (field: 'hair_density' | 'hair_length', value: string, options: string[], confirmed: boolean) => (
    <div className="flex items-center gap-2">
      <select value={value} onChange={(e) => update(field, e.target.value)} disabled={saving === field}
        aria-label={field === 'hair_density' ? 'Hair density' : 'Hair length'}
        className="bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-white focus:outline-none focus:border-amber-500">
        <option value={value}>{value} (Detected)</option>
        {options.map((o) => <option key={o} value={o}>{o} (Override)</option>)}
      </select>
      {saving === field ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" /> : confirmed && <Check className="w-3.5 h-3.5 text-emerald-400" />}
    </div>
  );

  return (
    <div className="bg-slate-800/70 border border-slate-700/60 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-400">
        {FLOW.map((step, i) => (
          <React.Fragment key={step}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
            <span className={i === FLOW.length - 1 ? 'text-amber-400' : 'text-emerald-400'}>{step}</span>
          </React.Fragment>
        ))}
      </div>

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
            <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Hair Length</p>
              {select('hair_length', length, LENGTHS, analysis.hair_length_source === 'stylist')}
            </div>
            <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Hair Density</p>
              {select('hair_density', density, DENSITIES, analysis.hair_density_source === 'stylist')}
            </div>
          </div>
          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
            Hair length and density are automatically analyzed from your uploaded photo. Manual dropdown selection is optional (use only to preview hair extension units or override).
          </p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        </div>
      </div>
    </div>
  );
};
