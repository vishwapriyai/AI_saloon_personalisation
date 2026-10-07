import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, UserPlus, RefreshCw, X } from 'lucide-react';
import { createCustomer, uploadCustomerAvatar } from '../api/client';
import { CameraCapture } from './CameraCapture';
import { workBranchId } from '../utils/workBranch';

interface Props {
  /** Pre-filled from the search box: a mobile number or a name */
  initialQuery?: string;
  onCreated: (customer: any) => void;
  onCancel: () => void;
}

const field = 'w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-base';
const label = 'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5';

/** Staff: register a new walk-in customer with a photo, name, customer ID and mobile number. */
export const AddCustomerForm: React.FC<Props> = ({ initialQuery = '', onCreated, onCancel }) => {
  const digits = initialQuery.replace(/\D/g, '');
  const looksLikePhone = digits.length >= 6;
  const [fullName, setFullName] = useState(looksLikePhone || /^cust-/i.test(initialQuery) ? '' : initialQuery.trim());
  const [phone, setPhone] = useState(looksLikePhone ? digits.slice(-10) : '');
  const [code, setCode] = useState(/^cust-/i.test(initialQuery.trim()) ? initialQuery.trim().toUpperCase() : '');
  const [gender, setGender] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const customer = await createCustomer({
        full_name: fullName.trim(), phone_number: phone, customer_code: code.trim() || undefined,
        gender: gender || undefined, email: email.trim() || undefined, date_of_birth: dob || undefined,
        branch_id: workBranchId(),
      });
      if (photo) {
        try {
          const { avatar_url } = await uploadCustomerAvatar(customer.id, photo);
          customer.avatar_url = avatar_url;
        } catch (err) {
          console.error('Customer saved, photo upload failed:', err);
        }
      }
      onCreated(customer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><UserPlus className="w-5 h-5 text-amber-400" /> Add New Customer</h2>
          <p className="text-xs text-slate-400 mt-1">Customer ID is created automatically if left empty. The customer can log in with the sample password and change it later.</p>
        </div>
        <button type="button" onClick={onCancel} className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:text-white" aria-label="Cancel">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
        <div className="space-y-2">
          <span className={label}>Customer Photo</span>
          <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-slate-950 border border-slate-700 flex items-center justify-center">
            {preview ? (
              <>
                <img src={preview} alt="New customer" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setPhoto(null)} className="absolute top-2 right-2 p-2 rounded-lg bg-slate-950/80 text-slate-200" aria-label="Remove photo">
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : <span className="text-[11px] text-slate-500 px-3 text-center">Optional — shown on the customer card</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setCamera(true)} className="min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5">
              <Camera className="w-4 h-4" /> Camera
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5">
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ''; }} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="nc-name">Name *</label>
            <input id="nc-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={field} placeholder="e.g. Meena Raghavan" />
          </div>
          <div>
            <label className={label} htmlFor="nc-phone">Mobile Number *</label>
            <input id="nc-phone" required inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))} className={field} placeholder="10-digit mobile" />
          </div>
          <div>
            <label className={label} htmlFor="nc-code">Customer ID</label>
            <input id="nc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${field} font-mono`} placeholder="Auto (e.g. CUST-1A2B3C)" />
          </div>
          <div>
            <label className={label} htmlFor="nc-gender">Gender</label>
            <select id="nc-gender" value={gender} onChange={(e) => setGender(e.target.value)} className={field}>
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="nc-dob">Date of Birth</label>
            <input id="nc-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="nc-email">Email</label>
            <input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="Optional" />
          </div>
        </div>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 text-center">{error}</div>}

      <button type="submit" disabled={saving || !fullName.trim() || phone.replace(/\D/g, '').length < 10}
        className="w-full min-h-[56px] rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
        {saving ? <RefreshCw className="w-6 h-6 animate-spin" /> : <><UserPlus className="w-5 h-5" /> Save Customer</>}
      </button>

      {camera && (
        <CameraCapture title="Customer Photo" hint="Face the camera in good light" facing="user"
          onCapture={(f) => { setPhoto(f); setCamera(false); }} onClose={() => setCamera(false)} />
      )}
    </form>
  );
};
