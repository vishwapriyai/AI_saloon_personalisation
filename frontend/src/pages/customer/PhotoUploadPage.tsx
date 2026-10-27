import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowRight, Check, Lightbulb, Lock } from 'lucide-react';
import { getConsent, saveConsent, uploadCustomerPhoto } from '../../api/client';
import type { ConsentChoices, ConsentState, PhotoView } from '../../api/client';
import { currentCustomerId, getSession, isStaff } from '../../auth/session';
import { MultiViewCapture } from '../../components/MultiViewCapture';
import { ConsentPanel } from '../../components/ConsentPanel';
import { consentComplete, emptyChoices } from '../../utils/consent';

const STEPS = ['Photos', 'Preferences', 'Your look', 'Stylist guide'];

export const PhotoUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Partial<Record<PhotoView, File | null>>>({});

  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [choices, setChoices] = useState<ConsentChoices>(emptyChoices(null));
  const staff = isStaff(getSession());

  useEffect(() => {
    getConsent(currentCustomerId())
      .then((c) => { setConsent(c); setChoices(emptyChoices(c)); })
      .catch((e) => setUploadError(e instanceof Error ? e.message : 'Could not load the consent details'));
  }, []);

  const frontFile = photos.front ?? null;
  const backFile = photos.back ?? null;
  const biometricConsent = consentComplete(consent, choices);
  const consentChanged = !consent?.recorded
    || (Object.keys(choices) as (keyof ConsentChoices)[]).some((k) => choices[k] !== consent[k]);

  const handleUploadAndAnalyze = async () => {
    if (!frontFile || !backFile) return;
    const customerId = currentCustomerId();
    setLoading(true);
    setUploadError(null);

    try {
      if (consentChanged) setConsent(await saveConsent(customerId, choices));
      const res = await uploadCustomerPhoto(customerId, frontFile, photos.back ?? null, photos.side ?? null);
      localStorage.setItem('salon_photo_id', String(res.photo_id));
      localStorage.setItem('salon_original_image_url', res.original_image_url);
      localStorage.setItem('salon_photo_analysis', JSON.stringify({ ...res.facial_features, hair_density: res.hair_density }));
      navigate('/customer/service');
    } catch (err) {
      // Never continue with another photo: every preview must be generated from this customer's own photo
      console.error(err);
      setUploadError(err instanceof Error ? err.message : 'Photo upload failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const requiredDone = (frontFile ? 1 : 0) + (backFile ? 1 : 0);
  const canContinue = !!frontFile && !!backFile && biometricConsent && !loading;
  const footerHint = requiredDone < 2
    ? 'Add the front and back photos to continue'
    : !biometricConsent
      ? 'Accept the required consents above to continue'
      : 'All set. Continue to pick your style';

  const RING = 2 * Math.PI * 34;

  return (
    <div className="auth-rise flex-1 py-2 sm:py-4">
      <div className="w-full overflow-clip rounded-3xl border border-[#dfe7e1] bg-[#ffffff] shadow-[0_24px_60px_-30px_rgba(36,74,55,0.35)]">
        {/* Header band: title, progress, steps */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-5 sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">Step 1 of 4</p>
              <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-[#ffffff]">Add your photos</h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#ffffff]/75">
                Front for face shape, back for true hair length and density. Side is optional and adds a 3D view.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-[#ffffff]/10 py-2 pl-2 pr-4 ring-1 ring-[#ffffff]/10">
              <div className="relative size-12" role="img" aria-label={`${requiredDone} of 2 required photos added`}>
                <svg viewBox="0 0 84 84" className="size-full -rotate-90">
                  <circle cx="42" cy="42" r="34" fill="none" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="9" />
                  <circle
                    cx="42" cy="42" r="34" fill="none" stroke="#f3d27a" strokeWidth="9" strokeLinecap="round"
                    strokeDasharray={RING} strokeDashoffset={RING * (1 - requiredDone / 2)}
                    className="transition-all duration-700"
                  />
                </svg>
                <span className="absolute inset-0 grid place-items-center text-xs font-bold text-[#ffffff]">{requiredDone}/2</span>
              </div>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-semibold text-[#ffffff]">{requiredDone === 2 ? 'Photos ready' : 'Required photos'}</p>
                <p className="mt-0.5 text-xs text-[#ffffff]/65">{requiredDone === 2 ? 'Front and back added' : `${2 - requiredDone} more to add`}</p>
              </div>
            </div>
          </div>

          <ol aria-label="Progress, step 1 of 4" className="relative mt-4 hidden items-center gap-2 sm:flex">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <li className="flex items-center gap-2" aria-current={i === 0 ? 'step' : undefined}>
                  <span className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
                    i === 0 ? 'bg-[#f3d27a] text-[#1d3d2d]' : 'bg-[#ffffff]/10 text-[#ffffff]/60'
                  }`}>
                    {i + 1}
                  </span>
                  <span className={`text-xs ${i === 0 ? 'font-semibold text-[#ffffff]' : 'text-[#ffffff]/60'}`}>{label}</span>
                </li>
                {i < STEPS.length - 1 && <span className="h-px min-w-3 flex-1 bg-[#ffffff]/15" />}
              </React.Fragment>
            ))}
          </ol>
        </div>

        {/* Body: stage (left) + list, tips, consent, continue (right) */}
        <div className="p-4 sm:p-6">
          <MultiViewCapture photos={photos} required={['front', 'back']} onChange={(view, file) => setPhotos((p) => ({ ...p, [view]: file }))}>
            <div className="flex items-start gap-3 rounded-2xl border border-[#e9d9a8] bg-[#fdf8e8] p-3 text-xs leading-relaxed text-[#6b5a22]">
              <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#8a6d12]" />
              <p>
                <strong className="font-semibold text-[#4d3f0f]">Tip:</strong> women, take the front photo with hair loose (not tied back), in good even light, looking straight at the camera.
              </p>
            </div>

            <ConsentPanel state={consent} choices={choices} onChange={setChoices} staff={staff} />

            {uploadError && (
              <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-700">
                {uploadError}
              </div>
            )}

            {/* Footer: checklist + continue (sticks to the bottom on small screens) */}
            <div className="flex flex-col gap-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-4 max-lg:-mb-4 max-lg:border-t max-lg:border-[#ebf0ec] max-lg:bg-[#ffffff]/90 max-lg:px-4 max-lg:py-3 max-lg:backdrop-blur-md sm:max-lg:-mx-6 sm:max-lg:-mb-6 sm:max-lg:px-6">
              <ul className="flex flex-wrap gap-2" aria-label="What is still needed">
                {[
                  { label: 'Front photo', ok: !!frontFile },
                  { label: 'Back photo', ok: !!backFile },
                  { label: 'Consent', ok: biometricConsent },
                ].map(({ label, ok }) => (
                  <li
                    key={label}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      ok ? 'bg-[#e4eee7] text-[#2f5d46]' : 'bg-[#f1f4f1] text-[#8a9a92]'
                    }`}
                  >
                    <span className={`grid size-4 place-items-center rounded-full ${ok ? 'bg-[#2f5d46] text-[#ffffff]' : 'border border-[#c3d3c9]'}`}>
                      {ok && <Check aria-hidden="true" className="size-2.5" />}
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
              <p className="sr-only" aria-live="polite">{footerHint}</p>

              <button
                onClick={handleUploadAndAnalyze}
                disabled={!canContinue}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl px-8 text-sm font-semibold transition-all ${
                  canContinue
                    ? 'bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-[#ffffff] shadow-lg shadow-[#244a37]/25 ring-4 ring-[#2f5d46]/15 hover:from-[#1b392b] hover:to-[#244a37] hover:shadow-xl active:scale-[0.98] cursor-pointer'
                    : 'cursor-not-allowed border border-[#e4eee7] bg-[#f1f4f1] text-[#a3b3a9]'
                }`}
              >
                {loading ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    <span>Analysing photos…</span>
                  </>
                ) : (
                  <>
                    <span>Continue</span>
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#8a9a92]">
                <Lock aria-hidden="true" className="size-3.5 shrink-0" /> Your photos are only used to make your previews.
              </p>
            </div>
          </MultiViewCapture>
        </div>
      </div>
    </div>
  );
};
