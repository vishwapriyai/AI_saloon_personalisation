import type { CustomerHistory } from '../api/client';
import type { RepeatableStyle } from '../components/CustomerFullProfile';

export type ContinueTarget =
  | { kind: 'style'; style: RepeatableStyle; hint: string }
  | { kind: 'photo'; photo: NonNullable<CustomerHistory['latest_photo']>; hint: string }
  | { kind: 'none'; hint: string };

/**
 * What "Continue Previous Style" continues: the last chosen style, else a saved style or AI preview,
 * else the last photo session (e.g. when every preview failed), else nothing yet.
 */
export function continueTarget(history: CustomerHistory | null, previous?: RepeatableStyle | null): ContinueTarget {
  const style: RepeatableStyle | null = previous?.reference_image_url ? previous
    : history?.saved_styles[0] ? { hairstyle_id: history.saved_styles[0].style_id, hairstyle_name: history.saved_styles[0].style_name, reference_image_url: history.saved_styles[0].image_url }
    : history?.ai_previews?.[0] ? { hairstyle_id: history.ai_previews[0].style_id, hairstyle_name: history.ai_previews[0].style_name, reference_image_url: history.ai_previews[0].image_url }
    : null;
  if (style) return { kind: 'style', style, hint: style.hairstyle_name || 'Last chosen look' };
  if (history?.latest_photo) return { kind: 'photo', photo: history.latest_photo, hint: `Reuse photos from ${history.latest_photo.date} — retry AI previews` };
  return { kind: 'none', hint: history ? 'No previous style yet' : 'Loading...' };
}

/** Reuse the previous photo session (photos + analysis): go straight to choosing services. */
export function applyPreviousPhotoSession(photo: NonNullable<CustomerHistory['latest_photo']>): void {
  localStorage.setItem('salon_photo_id', String(photo.photo_id));
  localStorage.setItem('salon_original_image_url', photo.original_image_url);
  localStorage.setItem('salon_photo_analysis', JSON.stringify(photo.facial_features));
}
