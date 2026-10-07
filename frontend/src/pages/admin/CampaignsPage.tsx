import React, { useState } from 'react';
import { Tag, Sparkles, RefreshCw } from 'lucide-react';
import { recommendOffer } from '../../api/client';

export const CampaignsPage: React.FC = () => {
  const [customerId, setCustomerId] = useState(4);
  const [loading, setLoading] = useState(false);
  const [offerResult, setOfferResult] = useState<any>(null);

  const handleCalculateOffer = async () => {
    setLoading(true);
    try {
      const res = await recommendOffer({ customer_id: customerId, service_id: 1 });
      setOfferResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Campaign & Coupon Engine</h1>
        <p className="text-slate-400 text-xs sm:text-sm">Automated rule + optimization engine for personalized offer generation</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Discount Optimization Test Tool */}
        <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-2xl space-y-5">
          <div className="flex items-center space-x-2">
            <Tag className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-lg">Test Automatic Discount Recommendation</h3>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Select Target Customer</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              <option value={1}>Alex Mercer (Regular Customer)</option>
              <option value={2}>David Miller (High-Spending Customer)</option>
              <option value={3}>Rohan Kapoor (Occasional Customer)</option>
              <option value={4}>Karan Verma (Rare / At-Risk Customer)</option>
              <option value={5}>Siddharth Malhotra (Gold Member)</option>
            </select>
          </div>

          <button
            onClick={handleCalculateOffer}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3.5 rounded-xl text-sm shadow-sm active:scale-95 transition-all flex items-center justify-center space-x-2 touch-target-large"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            <span>Calculate Automated Discount & Generate Coupon</span>
          </button>
        </div>

        {/* Calculated Coupon Result Display */}
        {offerResult && (
          <div className="bg-slate-900/80 border border-amber-500/40 p-6 rounded-2xl space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Engine Calculation Result</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                Margin Guard Respected (30%+)
              </span>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-400">Target Segment: <strong className="text-white">{offerResult.customer_segment}</strong></p>
              <p className="text-xs text-slate-400">Capacity State: <strong className="text-cyan-400">{offerResult.capacity_level}</strong></p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-300 font-semibold">Recommended Discount</p>
                <h4 className="text-3xl font-bold text-white">{offerResult.calculated_discount_pct}% OFF</h4>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Final Price</p>
                <h4 className="text-2xl font-bold text-emerald-400">₹{offerResult.final_price}</h4>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between font-mono text-sm">
              <span className="text-slate-400">Personalized Coupon Code:</span>
              <span className="text-amber-400 font-bold">{offerResult.coupon_code}</span>
            </div>

            <p className="text-xs text-slate-400 italic bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
              "{offerResult.explanation}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
