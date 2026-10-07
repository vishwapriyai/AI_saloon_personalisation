export const WORK_BRANCH_KEY = 'salon_work_branch_id';

/** The branch this tablet is working at (kept on the device; recorded on every completed visit). */
export function workBranchId(): number | null {
  try {
    return Number(localStorage.getItem(WORK_BRANCH_KEY) || 0) || null;
  } catch {
    return null;
  }
}
