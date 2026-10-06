import React, { useEffect, useState } from 'react';
import { Share2, Award, Copy, Check } from 'lucide-react';
import { getCustomerHistory, getShareLink, PUBLIC_APP_URL } from '../../api/client';

export const CustomerHistoryPage: React.FC = () => {
  const [history, setHistory] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [share, setShare] = useState<{ referral_code: string; share_path: string; discount_percent: number; salon_name: string } | null>(null);

  useEffect(() => {
    const customerId = Number(localStorage.getItem('salon_customer_id') || 1);
    getCustomerHistory(customerId)
      .then((res) => setHistory(res))
      .catch((err) => console.error(err));
    getShareLink(customerId)
      .then(setShare)
      .catch((err) => console.error(err));
  }, []);

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
      <div className="bg-slate-800/80 p-6 rounded-3xl border border-slate-700/60 backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Customer Style History</h2>
          <p className="text-slate-400 text-sm">Your saved hairstyle references and salon visit logs</p>
        </div>

        <button
          onClick={handleShareWhatsApp}
          disabled={!share}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-3 rounded-2xl text-sm flex items-center space-x-2 shadow-lg shadow-emerald-600/20 touch-target-large active:scale-95"
        >
          <Share2 className="w-5 h-5" />
          <span>Share via WhatsApp</span>
        </button>
      </div>

      {/* Referral Link Card */}
      <div className="bg-gradient-to-r from-amber-500/10 to-purple-500/10 border border-amber-500/20 p-5 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4">
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

      {/* Style History Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Latest Selected Style</span>
            <span className="text-xs text-slate-400">{history?.selections?.[0]?.date || 'Recent Visit'}</span>
          </div>
          <div className="rounded-2xl overflow-hidden aspect-[4/5] bg-slate-950 border border-slate-700">
            <img
              src={history?.selections?.[0]?.reference_image_url || localStorage.getItem('salon_original_image_url') || ''}
              alt="Style"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="pt-1">
            <h4 className="font-bold text-white text-base">
              {JSON.parse(localStorage.getItem('salon_selected_style') || '{}')?.name || 'Personalized Hairstyle'}
            </h4>
            <p className="text-xs text-slate-400 mt-1">Customer: {history?.full_name || 'Valued Client'} • Verified Session</p>
          </div>
        </div>
      </div>

    </div>
  );
};
