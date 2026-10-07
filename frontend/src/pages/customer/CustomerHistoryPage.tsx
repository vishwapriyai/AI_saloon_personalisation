import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Award, Copy, Check } from 'lucide-react';
import { getShareLink, PUBLIC_APP_URL } from '../../api/client';
import { CustomerFullProfile, type RepeatableStyle } from '../../components/CustomerFullProfile';
import { preparePreviousStyle } from '../../utils/previousStyle';
import { currentCustomerId } from '../../auth/session';

export const CustomerHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [share, setShare] = useState<{ referral_code: string; share_path: string; discount_percent: number; salon_name: string } | null>(null);

  useEffect(() => {
    const customerId = currentCustomerId();
    getShareLink(customerId)
      .then(setShare)
      .catch((err) => console.error(err));
  }, []);

  const repeat = async (style: RepeatableStyle) => {
    await preparePreviousStyle(style, currentCustomerId());
    navigate('/customer/instructions');
  };

  const shareUrl = share ? `${PUBLIC_APP_URL}${share.share_path}` : '';
  const shareText = share
    ? `Check out my new hairstyle at ${share.salon_name}! Use my code ${share.referral_code} for ${share.discount_percent}% off your first visit: ${shareUrl}`
    : '';

  const handleShareWhatsApp = () => {
    if (!shareText) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleCopyLink = () => {
    if (!shareText) return;
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 space-y-6 py-4">
      {/* Header Banner */}
      <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Customer Style History</h2>
          <p className="text-slate-400 text-sm">Saved styles, service history and before / AI / after photos</p>
        </div>

        <button
          onClick={handleShareWhatsApp}
          disabled={!share}
          className="bg-emerald-600 hover:bg-emerald-700 text-slate-950 font-bold px-5 py-3 rounded-2xl text-sm flex items-center space-x-2 shadow-sm touch-target-large active:scale-95"
        >
          <Share2 className="w-5 h-5" />
          <span>Share via WhatsApp</span>
        </button>
      </div>

      {/* Referral Link Card */}
      <div className="bg-amber-50 border border-amber-500/20 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 font-bold flex items-center justify-center">
            <Award className="w-7 h-7" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Refer Friends & Earn Points</h3>
            <p className="text-xs text-slate-300">Share your style reference to earn 50 bonus loyalty points for each referral!</p>
          </div>
        </div>

        <button
          onClick={handleCopyLink}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs flex items-center space-x-2 border border-slate-700 touch-target-large"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Copied Link!' : 'Copy Referral Code'}</span>
        </button>
      </div>

      <CustomerFullProfile customerId={currentCustomerId()} onRepeat={repeat} initialTab="services" />

    </div>
  );
};
