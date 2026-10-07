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
  full_name: string; phone_number: string; password: string; gender?: string; referral_code?: string; branch_id?: number | null;
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

export type CustomerType = 'New' | 'Regular' | 'Priority' | 'Premium' | 'VIP';

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
  avatar_url?: string | null;
  average_spend: number;
  branches_visited_count: number;
  branches_visited: string[];
  customer_type: CustomerType;
  frequent_services: { name: string; count: number }[];
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

export async function getCustomers(search?: string, branchId?: number | null) {
  const params = new URLSearchParams();
  if (search) params.set('query', search);
  if (branchId) params.set('branch_id', String(branchId));
  const qs = params.toString();
  const url = qs ? `${API_BASE}/customers?${qs}` : `${API_BASE}/customers`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch customers list');
  return res.json();
}

export async function lookupCustomer(phoneNumber: string) {
  const res = await apiFetch(`${API_BASE}/customers/lookup/${phoneNumber}`);
  if (!res.ok) throw new Error('Failed to lookup customer');
  return res.json();
}

export interface NewCustomer {
  full_name: string;
  phone_number: string;
  customer_code?: string;
  email?: string;
  gender?: string;
  date_of_birth?: string;
  branch_id?: number | null;
}

/** Staff: add a walk-in customer (Customer ID is generated when left empty). */
export async function createCustomer(data: NewCustomer) {
  const res = await apiFetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not add the customer'));
  return res.json();
}

export async function uploadCustomerAvatar(customerId: number, file: File): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`${API_BASE}/customers/${customerId}/avatar`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not save the customer photo'));
  return res.json();
}

export interface Branch { id: number; code: string; name: string; city: string }

export async function getBranches(): Promise<{ home_branch_id: number | null; branches: Branch[] }> {
  const res = await apiFetch(`${API_BASE}/branches`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load branches'));
  return res.json();
}

/** Stylist confirms hair density / corrects hair length before recommendations. */
export async function confirmPhotoAnalysis(photoId: number, data: { hair_density?: string; hair_length?: string }) {
  const res = await apiFetch(`${API_BASE}/photos/${photoId}/analysis`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not save the hair details'));
  return res.json();
}

export async function uploadCustomerPhoto(customerId: number, file: File, backFile?: File | null, sideFile?: File | null) {
  const formData = new FormData();
  formData.append('file', file);
  if (backFile) {
    formData.append('back_file', backFile);
  }
  if (sideFile) {
    formData.append('side_file', sideFile);
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
  recommendation_id?: number;
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

export interface SavedStyle {
  id: number;
  style_id: number;
  style_name: string;
  service: string;
  image_url: string;
  stylist_instructions: string | null;
  saved_by: string | null;
  date: string;
}

export interface HistoryVisit {
  visit_id: number;
  date: string;
  branch: string | null;
  stylist: string | null;
  services: string[];
  amount: number;
  status: string;
  rating: number | null;
  style_name: string | null;
  language: string | null;
  instructions: string[];
  selection_id: number | null;
  images: { before: ViewSet; ai: ViewSet; after: ViewSet } | null;
  is_sample: boolean;
}

export interface LatestLook {
  source: 'selection' | 'photo';
  style_name: string | null;
  date: string;
  status: string;            // CONFIRMED (haircut pending), COMPLETED, NOT_SELECTED
  images: { before: ViewSet; ai: ViewSet; after: ViewSet };
  ai_failed: boolean;        // previews were attempted for the latest photo but none succeeded
}

export interface CustomerHistory {
  customer_id: number;
  full_name: string;
  total_visits: number;
  total_spent: number;
  latest_look: LatestLook | null;
  latest_photo: { photo_id: number; original_image_url: string; date: string; facial_features: Record<string, any> } | null;
  ai_previews: { style_id: number; style_name: string | null; image_url: string; date: string }[];
  selections: { selection_id: number; date: string; style_id: number | null; style_name: string | null; status: string; reference_image_url: string }[];
  saved_styles: SavedStyle[];
  visits: HistoryVisit[];
}

export async function getCustomerHistory(customerId: number): Promise<CustomerHistory> {
  const res = await apiFetch(`${API_BASE}/customer-history/${customerId}`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load the history'));
  return res.json();
}

/** Save Style: keeps the AI preview, style and steps in the customer's history. */
export async function saveFavouriteStyle(customerId: number, data: { style_id: number; image_url: string; recommendation_id?: number }): Promise<SavedStyle> {
  const res = await apiFetch(`${API_BASE}/customers/${customerId}/saved-styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not save this style'));
  return res.json();
}

export async function getSavedStyles(customerId: number): Promise<SavedStyle[]> {
  const res = await apiFetch(`${API_BASE}/customers/${customerId}/saved-styles`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load saved styles'));
  return res.json();
}

export async function deleteSavedStyle(savedId: number) {
  const res = await apiFetch(`${API_BASE}/saved-styles/${savedId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not remove the saved style'));
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

// ---------------------------------------------------------------- multi-view photos, comparison, instructions
export type PhotoView = 'front' | 'side' | 'back';
export type ViewSet = Record<PhotoView, string | null>;

export interface SelectionComparison {
  selection_id: number;
  status: string;
  style: { id: number | null; name: string | null; service: string; hair_length?: string };
  before: ViewSet;
  ai: ViewSet;
  after: ViewSet;
  errors?: Record<string, string>;
  missing_photos?: string[];
}

/** AI preview of the chosen style on the customer's side and back photos. */
export async function generateSelectionViews(selectionId: number): Promise<SelectionComparison> {
  const res = await apiFetch(`${API_BASE}/style-selections/${selectionId}/views`, { method: 'POST' });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not create the side and back previews'));
  return res.json();
}

export async function getSelectionComparison(selectionId: number): Promise<SelectionComparison> {
  const res = await apiFetch(`${API_BASE}/style-selections/${selectionId}/comparison`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load the comparison'));
  return res.json();
}

/** After the haircut: actual photos (front required) + rating; records the visit. */
export async function completeSelection(selectionId: number, photos: Partial<Record<PhotoView, File | null>>, rating: number,
  extra: { branch_id?: number | null; language?: string | null } = {}): Promise<SelectionComparison> {
  const form = new FormData();
  (['front', 'side', 'back'] as PhotoView[]).forEach((v) => { const f = photos[v]; if (f) form.append(`${v}_file`, f); });
  form.append('rating', String(rating));
  if (extra.branch_id) form.append('branch_id', String(extra.branch_id));
  if (extra.language) form.append('language', extra.language);
  const res = await apiFetch(`${API_BASE}/style-selections/${selectionId}/complete`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not save the finished haircut photos'));
  return res.json();
}

export type InstructionLanguage = 'en' | 'hi' | 'ta';

/** Stylist confirms the look and starts the haircut (records the instruction language). */
export async function confirmHaircut(selectionId: number, language: InstructionLanguage) {
  const res = await apiFetch(`${API_BASE}/style-selections/${selectionId}/confirm-haircut`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not confirm the haircut'));
  return res.json();
}

const selectionParam = (selectionId?: number | null) => (selectionId ? `&selection_id=${selectionId}` : '');

/** Cutting steps in the language; with a selection, this customer's notes are added. */
export async function getInstructions(styleId: number, lang: InstructionLanguage, selectionId?: number | null): Promise<{ steps: string[]; language: InstructionLanguage; translated: boolean }> {
  const res = await apiFetch(`${API_BASE}/instructions/${styleId}?lang=${lang}${selectionParam(selectionId)}`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Could not load the instructions'));
  return res.json();
}

/** Spoken steps as a playable object URL (the request needs the login token, so it is fetched first). */
export async function getInstructionAudio(styleId: number, lang: InstructionLanguage, selectionId?: number | null): Promise<{ url: string; language: string }> {
  const res = await apiFetch(`${API_BASE}/instructions/${styleId}/audio?lang=${lang}${selectionParam(selectionId)}`);
  if (!res.ok) throw new Error(await errorDetail(res, 'Audio is unavailable right now'));
  return { url: URL.createObjectURL(await res.blob()), language: res.headers.get('X-Audio-Language') || lang };
}

