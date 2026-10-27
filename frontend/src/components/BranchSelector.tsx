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
    <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe7e1] bg-[#ffffff] pl-3 pr-1 text-xs text-[#6c7e73]">
      <MapPin aria-hidden="true" className="size-4 text-[#2f6f9f]" />
      <span className="whitespace-nowrap font-semibold">Working at</span>
      <select value={branchId ?? ''} onChange={(e) => {
          const id = Number(e.target.value);
          localStorage.setItem(KEY, String(id));
          setBranchId(id);
          window.dispatchEvent(new CustomEvent('salon-branch-changed', { detail: id }));
        }}
        className="h-8 cursor-pointer rounded-lg border-0 bg-[#f2f7f3] px-2 text-sm font-semibold text-[#1a2a20] focus:outline-none focus:ring-2 focus:ring-[#2f5d46]/25">
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
};
