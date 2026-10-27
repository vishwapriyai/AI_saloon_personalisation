import React, { useState } from 'react';
import { ShieldCheck, RefreshCw, Eye, EyeOff, User, Lock } from 'lucide-react';
import { staffApprovalToken } from '../api/client';

interface Props {
  /** What the stylist is approving, e.g. "start the haircut" */
  action: string;
  onApproved: (staffToken: string) => void;
}

const field = 'h-11 w-full rounded-xl border border-[#c3d3c9] bg-[#ffffff] pl-10 text-sm font-medium text-[#1a2a20] placeholder-[#8b9a92] transition-all hover:border-[#9db5a6] focus:border-[#2f5d46] focus:outline-none focus:ring-4 focus:ring-[#2f5d46]/12';
const icon = 'pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#7f968a] transition-colors group-focus-within:text-[#2f5d46]';

/**
 * Shown when a customer is logged in on the tablet but a step needs a stylist (confirming or completing the
 * service). The stylist signs in here for this one action; their login is not kept on the device.
 */
export const StaffApproval: React.FC<Props> = ({ action, onApproved }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await staffApprovalToken(username.trim(), password);
      setPassword('');
      onApproved(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stylist sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fdf3d7] text-[#a3762a]">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#1a2a20]">Stylist approval</p>
          <p className="text-xs text-[#6c7e73]">A stylist signs in to {action}.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <div className="group relative">
          <User aria-hidden="true" className={icon} />
          <input className={`${field} pr-3`} placeholder="Stylist username" autoComplete="off" value={username}
            onChange={(e) => setUsername(e.target.value)} aria-label="Stylist username" />
        </div>
        <div className="group relative">
          <Lock aria-hidden="true" className={icon} />
          <input className={`${field} pr-11`} type={showPassword ? 'text' : 'password'} placeholder="Password" autoComplete="off" value={password}
            onChange={(e) => setPassword(e.target.value)} aria-label="Stylist password" />
          <button type="button" onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[#7f968a] hover:bg-[#2f5d46]/10 hover:text-[#2f5d46] cursor-pointer">
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <button type="submit" disabled={busy || !username.trim() || !password}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] px-6 text-sm font-semibold text-[#ffffff] shadow-md shadow-[#244a37]/20 transition-all hover:from-[#1b392b] hover:to-[#244a37] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
          {busy ? <RefreshCw aria-hidden="true" className="size-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
          Approve
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-[#8a9a92]">
        <Lock aria-hidden="true" className="size-3" /> Used only for this approval; the stylist's login is not saved on this device.
      </p>
    </form>
  );
};
