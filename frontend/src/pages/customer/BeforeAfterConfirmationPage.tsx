import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, CheckCircle2, RefreshCw } from 'lucide-react';
import { completeSelection, getSelectionComparison } from '../../api/client';
import type { PhotoView, SelectionComparison } from '../../api/client';
import { MultiViewCapture } from '../../components/MultiViewCapture';
import { ComparisonViewer } from '../../components/ComparisonViewer';
import { workBranchId } from '../../utils/workBranch';
import { getSession, isStaff } from '../../auth/session';
import { StaffApproval } from '../../components/StaffApproval';

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
  // Completing the service records the visit and the bill: a stylist's action
  const needsStylist = !isStaff(getSession());

  useEffect(() => {
    if (!selectionId) { setLoading(false); return; }
    getSelectionComparison(selectionId)
      .then(setComparison)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the comparison'))
      .finally(() => setLoading(false));
  }, [selectionId]);

  const handleComplete = async (staffToken?: string) => {
    if (!photos.front || !selectionId) return;
    setSaving(true);
    setError(null);
    try {
      setComparison(await completeSelection(selectionId, photos, rating, {
        branch_id: workBranchId(),
        language: localStorage.getItem('salon_audio_language'),
        staffToken,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the finished haircut photos');
    } finally {
      setSaving(false);
    }
  };

  const styleName = comparison?.style.name || selectedStyle?.name || 'Selected style';
  const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

  return (
    <div className="auth-rise flex-1 py-2 sm:py-4">
      <div className="w-full overflow-clip rounded-3xl border border-[#dfe7e1] bg-[#ffffff] shadow-[0_24px_60px_-30px_rgba(36,74,55,0.35)]">
        {/* Header band */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-5 sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#ffffff]/10 text-[#f3d27a] ring-1 ring-[#ffffff]/15">
                <CheckCircle2 aria-hidden="true" className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">
                  {completed ? 'Service completed' : 'Finish the service'}
                </p>
                <h2 className="mt-1 truncate text-2xl font-bold leading-tight tracking-tight text-[#ffffff]">{styleName}</h2>
                <p className="mt-0.5 text-[13px] text-[#ffffff]/75">Before, AI preview and the actual result</p>
              </div>
            </div>
            <span className={`hidden shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-flex ${
              completed ? 'bg-[#f3d27a] text-[#1d3d2d]' : 'bg-[#ffffff]/10 text-[#ffffff] ring-1 ring-[#ffffff]/15'
            }`}>
              {completed ? 'Saved to history' : 'In progress'}
            </span>
          </div>
        </div>

        <div className="space-y-7 p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#6c7e73]">
              <RefreshCw aria-hidden="true" className="size-5 animate-spin" /> Loading…
            </div>
          ) : !selectionId ? (
            <div className="rounded-2xl border border-[#e9d9a8] bg-[#fdf8e8] px-4 py-3 text-center text-sm text-[#6b5a22]">
              This style was not saved as a confirmed selection, so the result cannot be recorded. Go back to the recommendations and confirm the style again.
            </div>
          ) : (
            <>
              {comparison && (
                <section>
                  <h3 className="mb-3 text-sm font-bold text-[#1a2a20]">Comparison</h3>
                  <ComparisonViewer
                    key={completed ? 'done' : 'pending'}
                    before={comparison.before}
                    ai={comparison.ai}
                    after={completed ? comparison.after : { front: null, side: null, back: null }}
                    missing={{ ai: 'Preview unavailable', after: completed ? 'Not captured' : 'Capture below' }}
                  />
                </section>
              )}

              {!completed && (
                <section className="space-y-4 border-t border-[#ebf0ec] pt-6">
                  <div>
                    <h3 className="text-sm font-bold text-[#1a2a20]">Capture the finished haircut</h3>
                    <p className="mt-0.5 text-xs text-[#6c7e73]">The front photo is required; side and back complete the comparison.</p>
                  </div>
                  <MultiViewCapture photos={photos} onChange={(view, file) => setPhotos((p) => ({ ...p, [view]: file }))}>
                    {/* Rating */}
                    <div className="rounded-2xl border border-[#dfe7e1] bg-[#fafcfa] p-4">
                      <p className="text-xs font-semibold text-[#33483c]">How was your experience?</p>
                      <div className="mt-2 flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setRating(star)}
                            className="rounded-lg p-1 transition-transform hover:scale-110 cursor-pointer"
                            aria-label={`${star} star${star > 1 ? 's' : ''}`}
                          >
                            <Star aria-hidden="true" className={`size-7 ${star <= rating ? 'fill-[#e9b949] text-[#e9b949]' : 'text-[#d3dbd5]'}`} />
                          </button>
                        ))}
                        <span className="ml-2 text-sm font-semibold text-[#a3762a]">{RATING_LABELS[rating]}</span>
                      </div>
                    </div>

                    {error && (
                      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-700">{error}</div>
                    )}

                    {needsStylist && photos.front ? (
                      <StaffApproval action="complete the service and record the visit" onApproved={(token) => handleComplete(token)} />
                    ) : (
                      <button
                        onClick={() => handleComplete()}
                        disabled={!photos.front || saving}
                        className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${
                          photos.front && !saving
                            ? 'bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-[#ffffff] shadow-lg shadow-[#244a37]/25 hover:from-[#1b392b] hover:to-[#244a37] active:scale-[0.98] cursor-pointer'
                            : 'cursor-not-allowed border border-[#e4eee7] bg-[#f1f4f1] text-[#a3b3a9]'
                        }`}
                      >
                        {saving ? <RefreshCw aria-hidden="true" className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
                        {saving ? 'Saving…' : photos.front ? 'Save result & complete service' : 'Add the front photo to continue'}
                      </button>
                    )}
                  </MultiViewCapture>
                </section>
              )}
            </>
          )}

          {error && (completed || !selectionId) && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-700">{error}</div>
          )}

          {(completed || !selectionId) && (
            <div className="relative overflow-hidden rounded-2xl border border-[#c3d3c9] bg-gradient-to-br from-[#f2f8f4] to-[#e4eee7] p-6 text-center">
              {completed && (
                <>
                  <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#244a37] text-[#f3d27a] shadow-lg shadow-[#244a37]/25">
                    <CheckCircle2 aria-hidden="true" className="size-7" />
                  </span>
                  <h3 className="mt-3 text-lg font-bold text-[#1a2a20]">Service completed &amp; saved</h3>
                  <p className="mx-auto mt-1 max-w-md text-xs text-[#4f6b5a]">
                    The visit and the final photos are stored. On the next visit this style can be continued from the profile.
                  </p>
                </>
              )}
              <div className="mx-auto mt-5 flex max-w-md gap-3">
                <button
                  onClick={() => navigate('/customer/history')}
                  className="h-11 flex-1 rounded-xl border border-[#c3d3c9] bg-[#ffffff] text-sm font-semibold text-[#2f5d46] transition-colors hover:border-[#2f5d46] cursor-pointer"
                >
                  View history
                </button>
                <button
                  onClick={() => navigate('/customer/login')}
                  className="h-11 flex-1 rounded-xl bg-[#244a37] text-sm font-semibold text-[#ffffff] shadow-md shadow-[#244a37]/20 transition-colors hover:bg-[#1b392b] cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
