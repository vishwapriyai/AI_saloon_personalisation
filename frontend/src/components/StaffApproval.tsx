import React, { useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { staffApprovalToken } from '../api/client';

interface Props {
  /** What the stylist is approving, e.g. "start the haircut" */
  action: string;
  onApproved: (staffToken: string) => void;
}

/**
 * Shown when a customer is logged in on the tablet but a step needs a stylist (confirming or completing the
 * service). The stylist signs in here for this one action; their login is not kept on the device.
 */
export const StaffApproval: React.FC<Props> = ({ action, onApproved }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  const input = 'w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl py-2.5 px-3 text-sm text-white placeholder-slate-500 focus:outline-none';
  return (
    <form onSubmit={submit} className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <p className="text-sm font-bold text-white flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-amber-400" /> Stylist sign-in needed to {action}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={input} placeholder="Stylist username" autoComplete="off" value={username}
          onChange={(e) => setUsername(e.target.value)} aria-label="Stylist username" />
        <input className={input} type="password" placeholder="Password" autoComplete="off" value={password}
          onChange={(e) => setPassword(e.target.value)} aria-label="Stylist password" />
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <button type="submit" disabled={busy || !username.trim() || !password}
        className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Approve
      </button>
    </form>
  );
};
