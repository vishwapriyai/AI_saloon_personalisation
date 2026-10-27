import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, Check, Upload, X } from 'lucide-react';
import { CameraCapture } from './CameraCapture';
import { PoseGuide } from './PoseGuide';
import type { PhotoView } from '../api/client';

const VIEWS: PhotoView[] = ['front', 'side', 'back'];

const VIEW_INFO: Record<PhotoView, { label: string; hint: string; facing: 'user' | 'environment' }> = {
  front: { label: 'Front', hint: 'Face camera, hair free / loose & let down (not tied back), good light', facing: 'user' },
  side: { label: 'Side', hint: 'Turn sideways so one ear and the side of the hair show', facing: 'environment' },
  back: { label: 'Back', hint: 'Turn around; someone else takes the back of the head', facing: 'environment' },
};

interface Props {
  photos: Partial<Record<PhotoView, File | null>>;
  onChange: (view: PhotoView, file: File | null) => void;
  required?: PhotoView[];
  /** Rendered in the right column, under the view list (tips, consent, continue). */
  children?: React.ReactNode;
}

/** Capture stage (left) with the Front / Side / Back list (right), each with Live Camera and Upload. */
export const MultiViewCapture: React.FC<Props> = ({ photos, onChange, required = ['front', 'back'], children }) => {
  const [active, setActive] = useState<PhotoView>('front');
  const [cameraView, setCameraView] = useState<PhotoView | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputs = { front: useRef<HTMLInputElement>(null), side: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null) };
  const [previews, setPreviews] = useState<Partial<Record<PhotoView, string>>>({});

  // Object URLs for previews, released when a photo changes
  useEffect(() => {
    const next: Partial<Record<PhotoView, string>> = {};
    VIEWS.forEach((v) => { const f = photos[v]; if (f) next[v] = URL.createObjectURL(f); });
    setPreviews(next);
    return () => Object.values(next).forEach((u) => u && URL.revokeObjectURL(u));
  }, [photos]);

  // After a photo is added, move on to the next required photo that is still missing
  const setPhoto = (view: PhotoView, file: File | null) => {
    onChange(view, file);
    if (!file) return;
    const next = VIEWS.find((v) => v !== view && required.includes(v) && !photos[v]);
    if (next) setActive(next);
  };

  const info = VIEW_INFO[active];
  const preview = previews[active];

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2 lg:gap-6">
      {/* LEFT: capture stage (viewfinder with drag & drop) */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && (f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name))) setPhoto(active, f);
        }}
        className={`relative h-[min(32rem,calc(100vh-20rem))] min-h-[20rem] overflow-hidden rounded-3xl border transition-colors lg:sticky lg:top-24 ${
          dragging ? 'border-[#2f5d46] bg-[#e4eee7]' : 'border-[#dfe7e1] bg-gradient-to-b from-[#f6faf7] to-[#e8f1ea]'
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${active}-${preview ? 'photo' : 'empty'}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0"
          >
            {preview ? (
              <>
                <img src={preview} alt={`${info.label} view`} className="h-full w-full object-contain pb-[4.75rem] pt-12" />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#2f5d46] px-3 py-1.5 text-xs font-semibold text-[#ffffff] shadow-md">
                  <Check aria-hidden="true" className="size-3.5" /> {info.label} photo added
                </span>
                <button
                  type="button"
                  onClick={() => setPhoto(active, null)}
                  className="absolute right-3 top-3 flex h-9 items-center gap-1.5 rounded-full bg-[#1a2a20]/75 px-3 text-xs font-semibold text-[#ffffff] backdrop-blur transition-colors hover:bg-[#1a2a20] cursor-pointer"
                  aria-label={`Remove ${info.label} photo`}
                >
                  <X aria-hidden="true" className="size-3.5" /> Remove
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => inputs[active].current?.click()}
                className="group absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 pb-20 pt-4 text-center cursor-pointer"
              >
                {/* viewfinder corners */}
                <span aria-hidden="true" className="absolute left-5 top-5 size-7 rounded-tl-xl border-l-[3px] border-t-[3px] border-[#2f5d46]/60 transition-all group-hover:left-4 group-hover:top-4" />
                <span aria-hidden="true" className="absolute right-5 top-5 size-7 rounded-tr-xl border-r-[3px] border-t-[3px] border-[#2f5d46]/60 transition-all group-hover:right-4 group-hover:top-4" />
                <span aria-hidden="true" className="absolute bottom-5 left-5 size-7 rounded-bl-xl border-b-[3px] border-l-[3px] border-[#2f5d46]/60 transition-all group-hover:bottom-4 group-hover:left-4" />
                <span aria-hidden="true" className="absolute bottom-5 right-5 size-7 rounded-br-xl border-b-[3px] border-r-[3px] border-[#2f5d46]/60 transition-all group-hover:bottom-4 group-hover:right-4" />

                {/* Center User Avatar Placeholder */}
                <div className="relative group-hover:scale-105 transition-all duration-300">
                  <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[#2f5d46]/15 motion-safe:animate-ping" />
                  <div className="relative size-28 sm:size-32 rounded-full overflow-hidden shadow-xl ring-4 ring-[#2f5d46]/20 border-2 border-white bg-white">
                    <img
                      src={`/avatars/placeholder_${active}.jpg`}
                      alt={`${info.label} view avatar guide`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <span className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full bg-[#2f5d46] text-[#ffffff] shadow-md ring-2 ring-white">
                    <Camera className="size-4" />
                  </span>
                </div>

                <span className="rounded-full bg-[#ffffff]/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#7f968a]">Example pose</span>
                <span className="text-sm font-semibold text-[#2f5d46]">
                  {dragging ? 'Drop the photo here' : `Tap to add your ${info.label.toLowerCase()} photo`}
                </span>
                <span className="hidden text-[11px] text-[#8a9a92] sm:block">or drag and drop a photo here</span>
              </button>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Actions: always visible at the bottom of the stage */}
        <div className="absolute inset-x-4 bottom-4 z-10 mx-auto grid max-w-md grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setCameraView(active)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-sm font-semibold text-[#ffffff] shadow-lg shadow-[#244a37]/30 transition-all hover:from-[#1b392b] hover:to-[#244a37] active:scale-[0.98] cursor-pointer"
          >
            <Camera aria-hidden="true" className="size-4" /> {preview ? 'Retake' : 'Live Camera'}
          </button>
          <button
            type="button"
            onClick={() => inputs[active].current?.click()}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#c3d3c9] bg-[#ffffff] text-sm font-semibold text-[#2f5d46] shadow-md shadow-[#244a37]/10 transition-all hover:border-[#2f5d46] hover:bg-[#f6faf7] active:scale-[0.98] cursor-pointer"
          >
            <Upload aria-hidden="true" className="size-4" /> {preview ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>

      {/* RIGHT: view list + whatever the page adds (tips, consent, continue) */}
      <div className="flex min-w-0 flex-col gap-4">
        <div role="tablist" aria-label="Photo views" className="flex flex-col gap-2.5">
          {VIEWS.map((v) => {
            const selected = v === active;
            const isRequired = required.includes(v);
            const added = !!previews[v];
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(v)}
                className={`flex items-center gap-3 rounded-2xl border p-2.5 text-left transition-all cursor-pointer ${
                  selected
                    ? 'border-[#2f5d46] bg-[#f2f8f4] shadow-md shadow-[#244a37]/10'
                    : 'border-[#dfe7e1] bg-[#ffffff] hover:border-[#c3d3c9]'
                }`}
              >
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#eef3ee] text-[#7f968a]">
                  {previews[v]
                    ? <img src={previews[v]} alt="" className="h-full w-full object-cover" />
                    : <PoseGuide view={v} className="size-9" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#1a2a20]">{VIEW_INFO[v].label} view</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      added ? 'bg-[#e4eee7] text-[#2f5d46]' : isRequired ? 'bg-[#fbeee0] text-[#a3602c]' : 'bg-[#f1f1ee] text-[#7f968a]'
                    }`}>
                      {added ? 'Added' : isRequired ? 'Required' : 'Optional'}
                    </span>
                  </span>
                  {selected && (
                    <span className="mt-0.5 block text-xs leading-snug text-[#6c7e73]">{VIEW_INFO[v].hint}</span>
                  )}
                </span>
                <span className={`grid size-6 shrink-0 place-items-center rounded-full ${
                  added ? 'bg-[#2f5d46] text-[#ffffff]' : 'border-2 border-[#c3d3c9]'
                }`}>
                  {added && <Check aria-hidden="true" className="size-3.5" />}
                </span>
              </button>
            );
          })}
        </div>

        {children}
      </div>

      {VIEWS.map((v) => (
        <input key={v} ref={inputs[v]} type="file" accept="image/*" capture={VIEW_INFO[v].facing} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(v, f); e.target.value = ''; }} />
      ))}

      {cameraView && (
        <CameraCapture
          title={`${VIEW_INFO[cameraView].label} View`}
          hint={VIEW_INFO[cameraView].hint}
          facing={VIEW_INFO[cameraView].facing}
          onCapture={(file) => { setPhoto(cameraView, file); setCameraView(null); }}
          onClose={() => setCameraView(null)}
        />
      )}
    </div>
  );
};
