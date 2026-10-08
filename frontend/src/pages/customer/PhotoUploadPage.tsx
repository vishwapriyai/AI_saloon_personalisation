import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { getConsent, saveConsent, uploadCustomerPhoto } from '../../api/client';
import type { ConsentChoices, ConsentState, PhotoView } from '../../api/client';
import { currentCustomerId, getSession, isStaff } from '../../auth/session';
import { MultiViewCapture } from '../../components/MultiViewCapture';
import { ConsentPanel } from '../../components/ConsentPanel';
import { consentComplete, emptyChoices } from '../../utils/consent';


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

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
      <div className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div className="text-center">
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            STEP 1 OF 4: PHOTO CAPTURE
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-2">Front, Side & Back Photos</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Front photo for face shape & Back photo for true hair length and density (required). Side photo optional for 3D view.
          </p>
        </div>

        <MultiViewCapture photos={photos} required={['front', 'back']} onChange={(view, file) => setPhotos((p) => ({ ...p, [view]: file }))} />

        <ConsentPanel state={consent} choices={choices} onChange={setChoices} staff={staff} />

        {uploadError && (
          <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 text-center">
            {uploadError}
          </div>
        )}

        <button
          onClick={handleUploadAndAnalyze}
          disabled={loading || !frontFile || !backFile || !biometricConsent}
          className={`w-full py-4 rounded-2xl text-lg font-bold shadow-sm transition-all flex items-center justify-center space-x-2 touch-target-large ${
            frontFile && backFile && biometricConsent && !loading
              ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 active:scale-[0.98]'
              : 'bg-slate-700/50 text-slate-500 border border-slate-700 cursor-not-allowed'
          }`}
        >
          {loading ? (
            <RefreshCw className="w-6 h-6 animate-spin text-slate-950" />
          ) : (
            <>
              <span>Continue</span>
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
