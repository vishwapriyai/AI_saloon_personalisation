import type { ConsentChoices, ConsentState } from '../api/client';

/** Photo analysis and AI previews are required; a minor also needs a parent's consent. */
export const consentComplete = (state: ConsentState | null, c: ConsentChoices) =>
  c.consent_photo_analysis && c.consent_third_party_ai && (!state?.is_minor || c.is_minor_parental_consent);

export const emptyChoices = (state: ConsentState | null): ConsentChoices => ({
  consent_photo_analysis: !!state?.consent_photo_analysis,
  consent_third_party_ai: !!state?.consent_third_party_ai,
  consent_history_retention: !!state?.consent_history_retention,
  consent_before_after_share: !!state?.consent_before_after_share,
  consent_marketing: !!state?.consent_marketing,
  is_minor_parental_consent: !!state?.is_minor_parental_consent,
});
