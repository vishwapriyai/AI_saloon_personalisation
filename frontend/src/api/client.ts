const API_BASE = '/api/v1';

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
  const res = await fetch(`${API_BASE}/customers/${customerId}/last-preferences`);
  if (!res.ok) return null;
  return (await res.json()).last_preferences;
}

export async function getShareLink(customerId: number) {
  const res = await fetch(`${API_BASE}/referrals/share-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id: customerId }),
  });
  if (!res.ok) throw new Error('Could not create a share link');
  return res.json() as Promise<{ referral_code: string; share_path: string; discount_percent: number; salon_name: string }>;
}

export async function getSharedReferral(code: string) {
  const res = await fetch(`${API_BASE}/referrals/${encodeURIComponent(code)}/public`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'This link is invalid or has expired.');
  }
  return res.json();
}

export async function salonLogin(username: string, password: string) {
  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Invalid username or password');
  }
  return res.json();
}

export async function getCustomers(search?: string) {
  const url = search ? `${API_BASE}/customers?query=${encodeURIComponent(search)}` : `${API_BASE}/customers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch customers list');
  return res.json();
}

export async function lookupCustomer(phoneNumber: string) {
  const res = await fetch(`${API_BASE}/customers/lookup/${phoneNumber}`);
  if (!res.ok) throw new Error('Failed to lookup customer');
  return res.json();
}

export async function createCustomer(data: { full_name: string; phone_number: string; email?: string; referral_code?: string }) {
  const res = await fetch(`${API_BASE}/customers`, {
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

  const res = await fetch(`${API_BASE}/customers/${customerId}/photo`, {
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
  const res = await fetch(`${API_BASE}/style-recommendations`, {
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
  const res = await fetch(`${API_BASE}/style-generations`, {
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
  const res = await fetch(`${API_BASE}/style-selections`, {
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
  const res = await fetch(`${API_BASE}/service-completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to complete service confirmation');
  return res.json();
}

export async function getCustomerHistory(customerId: number) {
  const res = await fetch(`${API_BASE}/customer-history/${customerId}`);
  if (!res.ok) throw new Error('Failed to fetch customer history');
  return res.json();
}

export async function getDashboardOverview() {
  const res = await fetch(`${API_BASE}/analytics/overview`);
  if (!res.ok) throw new Error('Failed to fetch dashboard overview');
  return res.json();
}

export async function getCapacityAnalytics() {
  const res = await fetch(`${API_BASE}/analytics/capacity`);
  if (!res.ok) throw new Error('Failed to fetch capacity analytics');
  return res.json();
}

export async function recommendOffer(payload: { customer_id: number; service_id: number }) {
  const res = await fetch(`${API_BASE}/analytics/recommend-offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to calculate recommended offer');
  return res.json();
}
