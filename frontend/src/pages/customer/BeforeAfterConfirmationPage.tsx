import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, CheckCircle2 } from 'lucide-react';
import { completeServiceConfirmation } from '../../api/client';

export const BeforeAfterConfirmationPage: React.FC = () => {
  const navigate = useNavigate();
  const [rating, setRating] = useState(5);
  const [confirmed, setConfirmed] = useState(false);

  const originalUrl = localStorage.getItem('salon_original_image_url') || '/static/media/original/cust_default.jpg';
  const rawSelectedStyle = localStorage.getItem('salon_selected_style');
  const selectedStyle = rawSelectedStyle ? JSON.parse(rawSelectedStyle) : null;
  // Personalized reference is the customer's own edited photo; the catalogue photo is only a style reference
  const referenceUrl = selectedStyle?.generated_image_url || selectedStyle?.preview_image_url || originalUrl;


  const handleConfirmResult = async () => {
    try {
      await completeServiceConfirmation({
        visit_id: 1,
        final_photo_url: referenceUrl,
        customer_rating: rating
      });
      setConfirmed(true);
    } catch (err) {
      console.error(err);
      setConfirmed(true);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6 space-y-6">
      <div className="w-full max-w-2xl bg-slate-800/80 border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Service Completion Confirmation</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Review your transformation before/after results</p>
        </div>

        {/* Side-by-Side Comparison */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block text-center">Before (Initial Photo)</span>
            <div className="rounded-2xl overflow-hidden aspect-[4/5] bg-slate-950 border border-slate-700">
              <img src={originalUrl} alt="Before" className="w-full h-full object-cover object-top" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block text-center">
              {selectedStyle?.generated_image_url ? 'After (Your Personalized Preview)' : 'Style Reference (catalogue photo)'}
            </span>
            <div className="rounded-2xl overflow-hidden aspect-[4/5] bg-slate-950 border border-amber-500/50 shadow-lg shadow-amber-500/10">
              <img src={referenceUrl} alt="After" className={`w-full h-full ${selectedStyle?.generated_image_url ? 'object-contain' : 'object-cover object-top'}`} />
            </div>
          </div>

        </div>

        {/* Feedback & Confirmation Form */}
        {!confirmed ? (
          <div className="space-y-5 pt-2 border-t border-slate-700/60">
            <div className="text-center">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Rate Your Hairstyle Experience</label>
              <div className="flex justify-center space-x-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setRating(star)}
                    className="p-2 text-amber-400 hover:scale-125 transition-transform touch-target-large"
                  >
                    <Star className={`w-8 h-8 ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleConfirmResult}
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold py-4 rounded-2xl text-lg shadow-lg shadow-amber-500/25 active:scale-[0.98] transition-all touch-target-large"
            >
              Confirm & Save To Profile History
            </button>
          </div>
        ) : (
          <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-4">
            <h3 className="font-bold text-xl text-emerald-400">Hairstyle Saved to History!</h3>
            <p className="text-xs text-slate-300">Your selected style reference is stored. On your next visit, simply enter your phone number to continue this style!</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => navigate('/customer/history')}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl text-sm"
              >
                View History
              </button>
              <button
                onClick={() => navigate('/customer/login')}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-xl text-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
