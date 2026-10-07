import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, CheckCircle2, RefreshCw } from 'lucide-react';
import { completeSelection, getSelectionComparison } from '../../api/client';
import type { PhotoView, SelectionComparison } from '../../api/client';
import { MultiViewCapture } from '../../components/MultiViewCapture';
import { ComparisonViewer } from '../../components/ComparisonViewer';
import { workBranchId } from '../../utils/workBranch';

export const BeforeAfterConfirmationPage: React.FC = () => {
  const navigate = useNavigate();
  const [rating, setRating] = useState(5);
  const [photos, setPhotos] = useState<Partial<Record<PhotoView, File | null>>>({});
  const [comparison, setComparison] = useState<SelectionComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectionId = Number(localStorage.getItem('salon_selection_id') || 0);
  const rawSelectedStyle = localStorage.getItem('salon_selected_style');
  const selectedStyle = rawSelectedStyle ? JSON.parse(rawSelectedStyle) : null;
  const completed = comparison?.status === 'COMPLETED';

  useEffect(() => {
    if (!selectionId) { setLoading(false); return; }
    getSelectionComparison(selectionId)
      .then(setComparison)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the comparison'))
      .finally(() => setLoading(false));
  }, [selectionId]);

  const handleComplete = async () => {
    if (!photos.front || !selectionId) return;
    setSaving(true);
    setError(null);
    try {
      setComparison(await completeSelection(selectionId, photos, rating, {
        branch_id: workBranchId(),
        language: localStorage.getItem('salon_audio_language'),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the finished haircut photos');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6 space-y-6">
      <div className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Service Completion</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            {comparison?.style.name || selectedStyle?.name || 'Selected style'} — Before, AI preview and the actual result
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 py-10"><RefreshCw className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : !selectionId ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 text-center">
            This style was not saved as a confirmed selection, so the result cannot be recorded. Go back to the recommendations and confirm the style again.
          </div>
        ) : (
          <>
            {comparison && (
              <ComparisonViewer
                key={completed ? 'done' : 'pending'}
                before={comparison.before}
                ai={comparison.ai}
                after={completed ? comparison.after : { front: null, side: null, back: null }}
                missing={{ ai: 'Preview unavailable', after: completed ? 'Not captured' : 'Capture below' }}
              />
            )}

            {!completed && (
              <div className="space-y-5 pt-4 border-t border-slate-700/60">
                <div>
                  <h3 className="text-base font-bold text-white">Capture the finished haircut</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Front photo is required; side and back complete the comparison.</p>
                </div>
                <MultiViewCapture photos={photos} onChange={(view, file) => setPhotos((p) => ({ ...p, [view]: file }))} />

                <div className="text-center">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Rate Your Hairstyle Experience</label>
                  <div className="flex justify-center space-x-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        className="p-2 text-amber-400 hover:scale-125 transition-transform touch-target-large"
                        aria-label={`${star} star${star > 1 ? 's' : ''}`}
                      >
                        <Star className={`w-8 h-8 ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleComplete}
                  disabled={!photos.front || saving}
                  className={`w-full font-bold py-4 rounded-2xl text-lg shadow-sm transition-all touch-target-large flex items-center justify-center gap-2 ${
                    photos.front && !saving
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 active:scale-[0.98]'
                      : 'bg-slate-700/50 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                >
                  {saving ? <RefreshCw className="w-6 h-6 animate-spin" /> : 'Save Result & Complete Service'}
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 text-center">{error}</div>
        )}

        {(completed || !selectionId) && (
          <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-4">
            {completed && (
              <>
                <h3 className="font-bold text-xl text-emerald-400">Service Completed & Saved to History!</h3>
                <p className="text-xs text-slate-300">The visit and the final photos are stored. On the next visit this style can be continued from the profile.</p>
              </>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => navigate('/customer/history')}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl text-sm"
              >
                View History
              </button>
              <button
                onClick={() => navigate('/customer/login')}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 rounded-xl text-sm"
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
