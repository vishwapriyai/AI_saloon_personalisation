// Salon name and tagline shown in the headers and on the login pages.
// Set them in frontend/.env (VITE_SALON_NAME, VITE_SALON_TAGLINE) to use your salon's own name.
export const BRAND = {
  name: (import.meta.env.VITE_SALON_NAME as string | undefined) || 'LUXE Styling',
  tagline: (import.meta.env.VITE_SALON_TAGLINE as string | undefined) || 'Hair • Skin • Grooming',
};
