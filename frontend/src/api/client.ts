import { clearSession, getSession, loginPathFor } from '../auth/session';

const API_BASE = '/api/v1';

/** fetch() with the login token; a 401 (expired or missing login) clears the device and opens the login page. */
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const session = getSession();
  const headers = new Headers(init.headers);
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    window.location.assign(loginPathFor(window.location.pathname));
  }
  return res;
}

const SERVER_UNREACHABLE = 'Cannot reach the salon server. Please check that the backend is running, then try again.';

async function errorDetail(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (typeof body?.detail === 'string') return body.detail;
  // No answer from the API itself (backend stopped, proxy error): not a wrong password
  return res.status >= 500 ? SERVER_UNREACHABLE : fallback;
}

/** fetch() for the login calls: a network failure is reported as "server unreachable". */
async function loginFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(SERVER_UNREACHABLE);
  }
}

// ---------------------------------------------------------------- login (plain fetch: a wrong password is not a session expiry)
export async function salonLogin(username: string, password: string) {
  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);
  const res = await loginFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Incorrect username or password'));
  return res.json() as Promise<{ access_token: string; role: string; user_id: number; full_name: string }>;
}

export interface CustomerLoginResult {
  access_token: string;
  role: string;
  found: boolean;
  customer: any;
}

export async function customerLogin(identifier: string, password: string): Promise<CustomerLoginResult> {
  const res = await loginFetch(`${API_BASE}/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Incorrect mobile number / customer ID or password'));
  return res.json();
}

export async function customerRegister(data: {
  full_name: string; phone_number: string; password: string; gender?: string; referral_code?: string;
}): Promise<CustomerLoginResult> {
  const res = await loginFetch(`${API_BASE}/auth/customer/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Registration failed. Please try again.'));
  return res.json();
}

// Public address of the app used in shared links. Set VITE_PUBLIC_APP_URL when the app is hosted
// (e.g. https://book.yoursalon.com); otherwise the current browser address is used.
export const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');

export interface LastPreferences {
  gender: 'Men' | 'Women' | null;
  target_services: string[];
  style_category: 'Classic' | 'Trendy' | 'Professional' | null;
  hairstyle_id: number | null;
}

export async function getLastPreferences(customerId: number): Promise<LastPreferences | null> {
  const res = await apiFetch(`${API_BASE}/customers/${customerId}/last-preferences`);
  if (!res.ok) return null;
  return (await res.json()).last_preferences;
}

export interface CustomerProfile {
  id: number;
  customer_code: string;
  full_name: string;
  gender: string | null;
  segment_name: string;
  total_visits: number;
  total_spent: number;
  last_visit_date: string | null;
  member_since: string | null;
  loyalty_points: number;
  membership: { name: string; valid_until: string | null; discount_percentage: number | null } | null;
}

/** Full style catalogue (haircuts, beard, colour, texture). Public. */
export async function getStyleCatalogue(): Promise<any[]> {
  const res = await apiFetch(`${API_BASE}/hairstyles`);
  if (!res.ok) throw new Error('Could not load the style catalogue');
  return res.json();
}

/** Latest returning-customer details: profile plus the most recently chosen style. */
export async function getCustomerSummary(customerId: number): Promise<{ found: boolean; customer: any }> {
  const res = await apiFetch(`${API_BASE}/customers/${customerId}/summary`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load your details'));
  return res.json();
}

export async function getCustomerProfile(customerId: number): Promise<CustomerProfile> {
  const res = await apiFetch(`${API_BASE}/customers/${customerId}/profile`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load your profile'));
  return res.json();
}

export async function getShareLink(customerId: number) {
  const res = await apiFetch(`${API_BASE}/referrals/share-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id: customerId }),
  });
  if (!res.ok) throw new Error('Could not create a share link');
  return res.json() as Promise<{ referral_code: string; share_path: string; discount_percent: number; salon_name: string }>;
}

export async function getSharedReferral(code: string) {
  const res = await apiFetch(`${API_BASE}/referrals/${encodeURIComponent(code)}/public`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'This link is invalid or has expired.');
  }
  return res.json();
}

export async function getCustomers(search?: string) {
  const url = search ? `${API_BASE}/customers?query=${encodeURIComponent(search)}` : `${API_BASE}/customers`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch customers list');
  return res.json();
}

export async function lookupCustomer(phoneNumber: string) {
  const res = await apiFetch(`${API_BASE}/customers/lookup/${phoneNumber}`);
  if (!res.ok) throw new Error('Failed to lookup customer');
  return res.json();
}

export async function createCustomer(data: { full_name: string; phone_number: string; email?: string; referral_code?: string }) {
  const res = await apiFetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create customer');
  return res.json();
}

export async function uploadCustomerPhoto(customerId: number, file: File, backFile?: File | null) {
  const formData = new FormData();
  formData.append('file', file);
  if (backFile) {
    formData.append('back_file', backFile);
  }

  const res = await apiFetch(`${API_BASE}/customers/${customerId}/photo`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Photo upload failed. Please try again.');
  }
  return res.json();
}


export async function getRecommendations(payload: {
  customer_id: number;
  photo_id: number;
  target_service_type: string;
  style_category: string;
  gender?: string;
}) {
  const res = await apiFetch(`${API_BASE}/style-recommendations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to fetch recommendations');
  return res.json();
}


export async function generateStyleImages(payload: {
  recommendation_id: number;
  selected_style_ids: number[];
}) {
  const res = await apiFetch(`${API_BASE}/style-generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to generate styles');
  return res.json();
}

export async function saveSelection(payload: {
  customer_id: number;
  hairstyle_id?: number;
  beard_style_id?: number;
  reference_image_url: string;
}) {
  const res = await apiFetch(`${API_BASE}/style-selections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save selection');
  return res.json();
}

export async function completeServiceConfirmation(payload: {
  visit_id: number;
  final_photo_url?: string;
  customer_rating?: number;
  notes?: string;
}) {
  const res = await apiFetch(`${API_BASE}/service-completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to complete service confirmation');
  return res.json();
}

export async function getCustomerHistory(customerId: number) {
  const res = await apiFetch(`${API_BASE}/customer-history/${customerId}`);
  if (!res.ok) throw new Error('Failed to fetch customer history');
  return res.json();
}

export async function getDashboardOverview() {
  const res = await apiFetch(`${API_BASE}/analytics/overview`);
  if (!res.ok) throw new Error('Failed to fetch dashboard overview');
  return res.json();
}

export async function getCapacityAnalytics() {
  const res = await apiFetch(`${API_BASE}/analytics/capacity`);
  if (!res.ok) throw new Error('Failed to fetch capacity analytics');
  return res.json();
}

export async function recommendOffer(payload: { customer_id: number; service_id: number }) {
  const res = await apiFetch(`${API_BASE}/analytics/recommend-offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to calculate recommended offer');
  return res.json();
}
