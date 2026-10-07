import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, SwitchCamera, X, RefreshCw } from 'lucide-react';

interface Props {
  title: string;
  hint: string;
  facing: 'user' | 'environment';
  onCapture: (file: File) => void;
  onClose: () => void;
}

/** Live camera (getUserMedia) with a guide frame. Browsers allow it only on https or localhost. */
export const CameraCapture: React.FC<Props> = ({ title, hint, facing, onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState(facing);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Live camera needs a secure connection (https or localhost). Close this and use "Take / Upload Photo" instead, which opens the device camera.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stop();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true));
        }
      })
      .catch((err) => {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in the browser settings, or use "Take / Upload Photo".'
          : 'No camera could be opened on this device. Use "Take / Upload Photo" instead.');
      });
    return () => { cancelled = true; stop(); };
  }, [facingMode, stop]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); } // save un-mirrored like the preview
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stop();
      onCapture(new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-400">{hint}</p>
          </div>
          <button onClick={() => { stop(); onClose(); }} className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200" aria-label="Close camera">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative aspect-[3/4] sm:aspect-[4/3] max-h-[70vh] mx-auto w-full rounded-2xl overflow-hidden bg-black border border-slate-700">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-amber-200">{error}</div>
          ) : (
            <>
              <video ref={videoRef} playsInline muted className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`} />
              {/* framing guide */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-1/2 h-3/4 rounded-[45%] border-2 border-dashed border-amber-400/70" />
              </div>
              {!ready && <div className="absolute inset-0 flex items-center justify-center text-slate-300 gap-2"><RefreshCw className="w-5 h-5 animate-spin" /> Starting camera...</div>}
            </>
          )}
        </div>

        {!error && (
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => setFacingMode((f) => (f === 'user' ? 'environment' : 'user'))}
              className="min-h-[52px] px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-2">
              <SwitchCamera className="w-5 h-5" /> Switch
            </button>
            <button onClick={capture} disabled={!ready}
              className="min-h-[56px] px-8 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-lg flex items-center gap-2 disabled:opacity-50">
              <Camera className="w-6 h-6" /> Capture
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
