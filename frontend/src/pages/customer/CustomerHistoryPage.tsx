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
    <div className="auth-rise flex-1 space-y-5 py-2 sm:py-4">
      {/* Header band */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-6 shadow-[0_24px_60px_-30px_rgba(36,74,55,0.45)] sm:px-7">
        <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">My history</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#ffffff]">Your style history</h2>
            <p className="mt-1 text-[13px] text-[#ffffff]/75">Saved styles, past services and before / AI / after photos.</p>
          </div>
          <button
            onClick={handleShareWhatsApp}
            disabled={!share}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#ffffff] px-5 text-sm font-semibold text-[#1d3d2d] shadow-lg shadow-black/15 transition-all hover:bg-[#f2f8f4] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
          >
            <Share2 aria-hidden="true" className="size-4 text-[#2f5d46]" /> Share via WhatsApp
          </button>
        </div>
      </div>

      {/* Referral ticket */}
      <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-[#efdca0] bg-gradient-to-r from-[#fdf8e8] to-[#fbefcc] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        {/* ticket notches */}
        <span aria-hidden="true" className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[#ffffff] ring-1 ring-[#efdca0]" />
        <span aria-hidden="true" className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[#ffffff] ring-1 ring-[#efdca0]" />
        <div className="flex items-center gap-4 pl-2">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#c9971f] text-[#ffffff] shadow-md shadow-[#c9971f]/30">
            <Award aria-hidden="true" className="size-6" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-[#4d3f0f]">Refer friends &amp; earn points</h3>
            <p className="text-xs text-[#6b5a22]">
              Earn 50 bonus loyalty points for each referral{share ? `, and your friend gets ${share.discount_percent}% off their first visit` : ''}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 pr-2">
          <span className="rounded-xl border-2 border-dashed border-[#d9b860] bg-[#ffffff]/70 px-4 py-2 font-mono text-sm font-bold tracking-wider text-[#5c430a]">
            {share?.referral_code || '······'}
          </span>
          <button
            onClick={handleCopyLink}
            disabled={!share}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-[#244a37] px-4 text-xs font-semibold text-[#ffffff] shadow-md transition-colors hover:bg-[#1b392b] disabled:opacity-60 cursor-pointer"
          >
            {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <CustomerFullProfile customerId={currentCustomerId()} onRepeat={repeat} initialTab="services" />
    </div>
  );
};
