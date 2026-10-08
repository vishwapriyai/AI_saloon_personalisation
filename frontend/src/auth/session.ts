// Login session for customers and salon staff, kept in localStorage on this device.

export type SessionKind = 'customer' | 'staff';

export interface Session {
  kind: SessionKind;
  token: string;
  role: string;          // 'Customer', 'Stylist', 'Receptionist', 'Salon Admin', 'Super Admin'
  name: string;
  customerId?: number;   // customer sessions only
  userId?: number;       // staff sessions only
}

const SESSION_KEY = 'salon_session';
const ADMIN_ROLES = ['Super Admin', 'Salon Admin'];

// Everything a customer session leaves on the device; cleared on logout so the next person starts clean
const SESSION_DATA_KEYS = [
  'salon_customer_id', 'salon_customer_name', 'salon_customer_summary', 'salon_photo_id',
  'salon_original_image_url', 'salon_recommendation_id', 'salon_recommended_styles',
  'salon_generated_results', 'salon_generation_pending', 'salon_selected_style', 'salon_selection_id',
  'salon_last_hairstyle_id', 'salon_staff_user', 'salon_photo_analysis', 'salon_must_change_password',
];

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** The customer currently being served: the logged-in customer, or the one a staff member selected. */
export function clearCustomerContext(): void {
  SESSION_DATA_KEYS.forEach((k) => localStorage.removeItem(k));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  clearCustomerContext();
}

/** The customer being served: the logged-in customer, or the one a staff member selected (0 if none). */
export function currentCustomerId(): number {
  const session = getSession();
  if (session?.kind === 'customer' && session.customerId) return session.customerId;
  return Number(localStorage.getItem('salon_customer_id') || 0);
}

export const isStaff = (s: Session | null) => s?.kind === 'staff';
export const isAdmin = (s: Session | null) => s?.kind === 'staff' && ADMIN_ROLES.includes(s.role);

/** Where to send someone who is not (or no longer) logged in for a given page. */
export function loginPathFor(pathname: string): string {
  return pathname.startsWith('/admin') || pathname.startsWith('/stylist') || pathname.startsWith('/staff')
    ? '/staff/login'
    : '/customer/login';
}
