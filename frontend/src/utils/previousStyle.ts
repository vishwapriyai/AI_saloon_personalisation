import { getStyleCatalogue } from '../api/client';

export interface PreviousStyle {
  hairstyle_id: number | null;
  hairstyle_name: string | null;
  reference_image_url: string | null;
}

/**
 * Prepares the instructions page for "Continue Previous Style": the catalogue entry of the customer's
 * latest chosen style (name, cutting steps, reference photos) plus their own saved preview image.
 */
export async function preparePreviousStyle(previous: PreviousStyle): Promise<void> {
  let style: any = {};
  try {
    const catalogue = await getStyleCatalogue();
    style = catalogue.find((s) => s.id === previous.hairstyle_id) || {};
  } catch (err) {
    console.error('Could not load the style catalogue:', err);
  }
  localStorage.setItem('salon_selected_style', JSON.stringify({
    ...style,
    style_id: previous.hairstyle_id,
    name: style.name || previous.hairstyle_name,
    generated_image_url: previous.reference_image_url || undefined,
    display_image: previous.reference_image_url || undefined,
  }));
}
