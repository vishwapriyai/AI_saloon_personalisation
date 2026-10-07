import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { getBranches, type Branch } from '../api/client';
import { WORK_BRANCH_KEY as KEY, workBranchId } from '../utils/workBranch';


export const BranchSelector: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(workBranchId);

  useEffect(() => {
    let active = true;
    getBranches()
      .then((r) => {
        if (!active) return;
        setBranches(r.branches);
        const current = workBranchId();
        if (!current || !r.branches.some((b) => b.id === current)) {
          const first = r.home_branch_id || r.branches[0]?.id || null;
          if (first) {
            localStorage.setItem(KEY, String(first));
            setBranchId(first);
            window.dispatchEvent(new CustomEvent('salon-branch-changed', { detail: first }));
          }
        }
      })
      .catch((e) => console.error('Could not load branches:', e));
    return () => { active = false; };
  }, []);

  if (!branches.length) return null;
  return (
    <label className="inline-flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl pl-3 pr-1 py-1 text-xs text-slate-300">
      <MapPin className="w-4 h-4 text-sky-400" />
      <span className="font-semibold whitespace-nowrap">Working at</span>
      <select value={branchId ?? ''} onChange={(e) => {
          const id = Number(e.target.value);
          localStorage.setItem(KEY, String(id));
          setBranchId(id);
          window.dispatchEvent(new CustomEvent('salon-branch-changed', { detail: id }));
        }}
        className="bg-slate-800 border border-slate-700 rounded-lg py-2 px-2 text-sm text-white focus:outline-none focus:border-amber-500">
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
};
