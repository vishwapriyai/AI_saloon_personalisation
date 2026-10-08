import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, X } from 'lucide-react';
import { CameraCapture } from './CameraCapture';
import type { PhotoView } from '../api/client';

const VIEW_INFO: Record<PhotoView, { label: string; hint: string; facing: 'user' | 'environment' }> = {
  front: { label: 'Front', hint: 'Face the camera, hair untied, good light', facing: 'user' },
  side: { label: 'Side', hint: 'Turn sideways so one ear and the side of the hair show', facing: 'environment' },
  back: { label: 'Back', hint: 'Turn around; someone else takes the back of the head', facing: 'environment' },
};

interface Props {
  photos: Partial<Record<PhotoView, File | null>>;
  onChange: (view: PhotoView, file: File | null) => void;
  required?: PhotoView[];
}

/** Front / side / back photo slots, each with Live Camera and Take / Upload Photo. */
export const MultiViewCapture: React.FC<Props> = ({ photos, onChange, required = ['front', 'back'] }) => {
  const [cameraView, setCameraView] = useState<PhotoView | null>(null);
  const inputs = { front: useRef<HTMLInputElement>(null), side: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null) };
  const [previews, setPreviews] = useState<Partial<Record<PhotoView, string>>>({});

  // Object URLs for previews, released when a photo changes
  useEffect(() => {
    const next: Partial<Record<PhotoView, string>> = {};
    (Object.keys(VIEW_INFO) as PhotoView[]).forEach((v) => { const f = photos[v]; if (f) next[v] = URL.createObjectURL(f); });
    setPreviews(next);
    return () => Object.values(next).forEach((u) => u && URL.revokeObjectURL(u));
  }, [photos]);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(Object.keys(VIEW_INFO) as PhotoView[]).map((view) => {
          const info = VIEW_INFO[view];
          const preview = previews[view];
          return (
            <div key={view} className="bg-slate-900/80 rounded-2xl border border-slate-700 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">{info.label} View</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${required.includes(view) ? 'text-amber-400' : 'text-slate-500'}`}>
                  {required.includes(view) ? 'Required' : 'Optional'}
                </span>
              </div>
              <div className="relative aspect-[4/5] rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                {preview ? (
                  <>
                    <img src={preview} alt={`${info.label} view`} className="w-full h-full object-cover" />
                    <button onClick={() => onChange(view, null)} className="absolute top-2 right-2 p-2 rounded-lg bg-slate-950/80 text-slate-200 hover:text-white" aria-label={`Remove ${info.label} photo`}>
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 text-center px-3">{info.hint}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCameraView(view)}
                  className="min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5">
                  <Camera className="w-4 h-4" /> Live Camera
                </button>
                <button type="button" onClick={() => inputs[view].current?.click()}
                  className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-700">
                  <Upload className="w-4 h-4" /> Take / Upload
                </button>
              </div>
              <input ref={inputs[view]} type="file" accept="image/*" capture={info.facing} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(view, f); e.target.value = ''; }} />
            </div>
          );
        })}
      </div>

      {cameraView && (
        <CameraCapture
          title={`${VIEW_INFO[cameraView].label} View`}
          hint={VIEW_INFO[cameraView].hint}
          facing={VIEW_INFO[cameraView].facing}
          onCapture={(file) => { onChange(cameraView, file); setCameraView(null); }}
          onClose={() => setCameraView(null)}
        />
      )}
    </>
  );
};
