import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, RefreshCw, ArrowRight } from 'lucide-react';
import { uploadCustomerPhoto } from '../../api/client';


export const PhotoUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  
  const [backFile, setBackFile] = useState<File | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [biometricConsent, setBiometricConsent] = useState(false);

  const handleFrontSelect = (file: File) => {
    setFrontFile(file);
    setFrontPreview(URL.createObjectURL(file));
  };

  const handleBackSelect = (file: File) => {
    setBackFile(file);
    setBackPreview(URL.createObjectURL(file));
  };

  const handleUploadAndAnalyze = async () => {
    if (!frontFile) return;
    const customerId = Number(localStorage.getItem('salon_customer_id') || 1);
    setLoading(true);
    setUploadError(null);

    try {
      const res = await uploadCustomerPhoto(customerId, frontFile, backFile);
      localStorage.setItem('salon_photo_id', String(res.photo_id));
      localStorage.setItem('salon_original_image_url', res.original_image_url);
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
      <div className="w-full max-w-2xl bg-slate-800/80 border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
        <div className="text-center">
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            STEP 1 OF 4: DUAL-ANGLE PHOTO CAPTURE
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-2">Front & Back Photo Analysis</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Capture front photo for facial structure & back photo for hair density & texture (Straight, Wavy, Curly, Coily)
          </p>
        </div>

        {/* Dual Photo Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card 1: Front Photo (Facial Structure & Face Shape) */}
          <div className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-4 flex flex-col items-center text-center space-y-3">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">
              1. Front Photo (Facial Structure)
            </span>
            <p className="text-[11px] text-slate-400">Determines Face Shape (Oval/Square/Round/Heart) & Features</p>

            {frontPreview ? (
              <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden bg-slate-950 border border-slate-700">
                <img src={frontPreview} alt="Front View" className="w-full h-full object-cover" />
                <button
                  onClick={() => { setFrontFile(null); setFrontPreview(null); }}
                  className="absolute top-2 right-2 bg-slate-900/80 text-slate-200 px-2 py-1 rounded-lg text-[10px] font-semibold"
                >
                  Retake
                </button>
              </div>
            ) : (
              <div
                onClick={() => frontInputRef.current?.click()}
                className="w-full aspect-[4/5] border-2 border-dashed border-slate-600 hover:border-amber-500 rounded-xl flex flex-col items-center justify-center p-4 cursor-pointer bg-slate-950/40 hover:bg-slate-900 transition-all group"
              >
                <Camera className="w-8 h-8 text-amber-400 group-hover:scale-110 transition-transform mb-2" />
                <span className="text-xs font-bold text-white">Capture Front Photo</span>
                <span className="text-[10px] text-slate-500 mt-1">Eye-level straight angle</span>
              </div>
            )}
            <input
              ref={frontInputRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFrontSelect(e.target.files[0])}
            />
          </div>

          {/* Card 2: Back Photo (Hair Density & Texture Analysis) */}
          <div className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-4 flex flex-col items-center text-center space-y-3">
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wide">
              2. Back Photo (Hair Density & Texture)
            </span>
            <p className="text-[11px] text-slate-400">Analyzes Crown/Nape Density (Fine/Medium/Thick) & 1A-4C Texture</p>

            {backPreview ? (
              <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden bg-slate-950 border border-slate-700">
                <img src={backPreview} alt="Back View" className="w-full h-full object-cover" />
                <button
                  onClick={() => { setBackFile(null); setBackPreview(null); }}
                  className="absolute top-2 right-2 bg-slate-900/80 text-slate-200 px-2 py-1 rounded-lg text-[10px] font-semibold"
                >
                  Retake
                </button>
              </div>
            ) : (
              <div
                onClick={() => backInputRef.current?.click()}
                className="w-full aspect-[4/5] border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-xl flex flex-col items-center justify-center p-4 cursor-pointer bg-slate-950/40 hover:bg-slate-900 transition-all group"
              >
                <Camera className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition-transform mb-2" />
                <span className="text-xs font-bold text-white">Capture Back Photo</span>
                <span className="text-[10px] text-slate-500 mt-1">Back of head & hair crown</span>
              </div>
            )}
            <input
              ref={backInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleBackSelect(e.target.files[0])}
            />
          </div>
        </div>

        {/* Biometric & Privacy Consent Checkbox */}
        <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-700 flex items-start space-x-3 text-left">
          <input
            type="checkbox"
            id="biometric-consent"
            checked={biometricConsent}
            onChange={(e) => setBiometricConsent(e.target.checked)}
            className="mt-1 w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500 accent-amber-500 cursor-pointer"
          />
          <label htmlFor="biometric-consent" className="text-xs text-slate-300 leading-relaxed cursor-pointer">
            <span className="font-semibold text-amber-400">Biometric & Texture Privacy Consent:</span> I agree to temporary computer vision facial structure, hair density, and texture analysis under Salon Privacy Policy. Photos are securely stored.
          </label>
        </div>

        {uploadError && (
          <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 text-center">
            {uploadError}
          </div>
        )}

        <button
          onClick={handleUploadAndAnalyze}
          disabled={loading || !frontFile || !biometricConsent}
          className={`w-full py-4 rounded-2xl text-lg font-bold shadow-lg transition-all flex items-center justify-center space-x-2 touch-target-large ${
            frontFile && biometricConsent && !loading
              ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-amber-500/25 active:scale-[0.98]'
              : 'bg-slate-700/50 text-slate-500 border border-slate-700 cursor-not-allowed'
          }`}
        >
          {loading ? (
            <RefreshCw className="w-6 h-6 animate-spin text-slate-950" />
          ) : (
            <>
              <span>Analyze Face Structure & Hair Density</span>
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};


