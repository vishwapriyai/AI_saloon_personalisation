import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Scissors, Gift, ArrowRight } from 'lucide-react';
import { getSharedReferral } from '../../api/client';

interface SharedReferral {
  referral_code: string;
  salon_name: string;
  referrer_first_name: string;
  hairstyle_name: string | null;
  reference_image_url: string | null;
  discount_percent: number;
}

// Public page opened from a WhatsApp/SMS share link: /r/:code
export const SharedReferralPage: React.FC = () => {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SharedReferral | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSharedReferral(code)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'This link is invalid or has expired.'));
  }, [code]);

  const handleClaim = () => {
    try {
      localStorage.setItem('salon_referral_code', code.toUpperCase());
    } catch { /* storage unavailable: the visit still works without the referral credit */ }
    navigate('/customer/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
        <div className="flex items-center justify-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center">
            <Scissors className="w-6 h-6" />
          </div>
          <span className="text-lg font-bold tracking-tight">{data?.salon_name || 'Salon'}</span>
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!data && !error && <p className="text-sm text-slate-400">Loading...</p>}

        {data && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{data.referrer_first_name} invited you!</h1>
              {data.hairstyle_name && (
                <p className="text-sm text-slate-400 mt-1">Their new look: {data.hairstyle_name}</p>
              )}
            </div>

            {data.reference_image_url && (
              <div className="mx-auto h-72 aspect-[4/5] max-w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/60">
                <img src={data.reference_image_url} alt={data.hairstyle_name || 'Hairstyle'} className="w-full h-full object-contain" />
              </div>
            )}

            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-center gap-3 text-left">
              <Gift className="w-8 h-8 text-amber-400 shrink-0" />
              <div>
                <p className="font-bold text-amber-300">{data.discount_percent}% off your first visit</p>
                <p className="text-xs text-slate-300">Code <span className="font-mono font-bold">{data.referral_code}</span> is applied when you sign up.</p>
              </div>
            </div>

            <button
              onClick={handleClaim}
              className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-base flex items-center justify-center gap-2"
            >
              Get my personalized look
              <ArrowRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
