import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, UserPlus, Phone, ChevronRight, ArrowLeft, UserCheck, Sparkles, IdCard, KeyRound, MapPin, X, ArrowRight } from 'lucide-react';
import { getCustomerHistory, getCustomers, resetCustomerPassword, type CustomerHistory } from '../../api/client';
import { CustomerAvatar, CustomerTypeBadge } from '../../components/CustomerInsights';
import { ServiceChip } from '../../components/ServiceIcon';
import { CustomerFullProfile, LatestLookCard, PreviousStylesStrip, ProfileCard, type RepeatableStyle } from '../../components/CustomerFullProfile';
import { AddCustomerForm } from '../../components/AddCustomerForm';
import { BranchSelector } from '../../components/BranchSelector';
import { clearCustomerContext, getSession } from '../../auth/session';
import { preparePreviousStyle } from '../../utils/previousStyle';
import { applyPreviousPhotoSession, continueTarget, type ContinueTarget } from '../../utils/continueStyle';

import { workBranchId } from '../../utils/workBranch';

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

/** One customer in the directory: who, client type, key numbers and top service at a glance. */
const DirectoryCard: React.FC<{ c: any; showBranchVisits: boolean; onOpen: () => void }> = ({ c, showBranchVisits, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="group flex w-full items-start gap-4 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#c3d3c9] hover:shadow-md cursor-pointer"
  >
    <CustomerAvatar name={c.full_name} url={c.avatar_url} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-[15px] font-bold text-[#1a2a20]">{c.full_name}</p>
        <CustomerTypeBadge type={c.customer_type} />
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#7f968a]">
        <span className="font-mono">{c.customer_code}</span>
        <span aria-hidden="true">·</span>
        {c.home_branch
          ? <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-3" />{c.home_branch}</span>
          : <span className="font-semibold text-[#a3762a]">New — no branch yet</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-[#eef3ee] px-2.5 py-1 text-[11px] font-semibold text-[#33483c]">{c.total_visits} {c.total_visits === 1 ? 'visit' : 'visits'}</span>
        <span className="rounded-full bg-[#eef3ee] px-2.5 py-1 text-[11px] font-semibold text-[#33483c]">{inr(c.total_spent)}</span>
        {showBranchVisits && c.visits_at_branch ? (
          <span className="rounded-full bg-[#e8f1f7] px-2.5 py-1 text-[11px] font-semibold text-[#2f5f7f]">{c.visits_at_branch} here</span>
        ) : null}
        {c.frequent_services?.[0] && <ServiceChip name={c.frequent_services[0].name} />}
      </div>
      {c.matched_by_phone && (
        <p className="mt-2 flex items-center gap-1 text-xs text-[#2f5d46]"><Phone aria-hidden="true" className="size-3" /> Matched mobile number</p>
      )}
    </div>
    <ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-[#a3b3a9] transition-transform group-hover:translate-x-0.5 group-hover:text-[#2f5d46]" />
  </button>
);

/** Staff home: find (or add) the customer being served, then repeat a previous style or create a new one. */
export const StaffCustomersPage: React.FC = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [customers, setCustomers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<number | null>(workBranchId);
  const [allBranches, setAllBranches] = useState(false);
  const scopeBranch = allBranches ? null : selectedBranch;
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [showFullProfile, setShowFullProfile] = useState(false);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const resetPassword = async (customer: any) => {
    if (!window.confirm(`Issue a new one-time password for ${customer.full_name}? Their current password stops working.`)) return;
    setResetError(null);
    try {
      setOneTimePassword((await resetCustomerPassword(customer.id)).temporary_password);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : 'Could not reset the password');
    }
  };

  useEffect(() => {
    const handleBranchChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setSelectedBranch(customEvent.detail);
    };
    window.addEventListener('salon-branch-changed', handleBranchChange);
    return () => window.removeEventListener('salon-branch-changed', handleBranchChange);
  }, []);

  useEffect(() => {
    setHistory(null);
    setShowFullProfile(false);
    setOneTimePassword(null);
    setResetError(null);
    if (!selected) return;
    let active = true;
    getCustomerHistory(selected.id)
      .then((h) => { if (active) setHistory(h); })
      .catch((e) => console.error('Could not load history:', e));
    return () => { active = false; };
  }, [selected]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      getCustomers(searchQuery.trim() || undefined, scopeBranch)
        .then((data) => { if (active) setCustomers(Array.isArray(data) ? data : []); })
        .catch((err) => console.error('Failed to load customers:', err))
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [searchQuery, scopeBranch]);

  const startFor = (customer: any) => {
    clearCustomerContext(); // the previous customer's session data must not carry over
    localStorage.setItem('salon_customer_id', String(customer.id));
    localStorage.setItem('salon_customer_name', customer.full_name);
    localStorage.setItem('salon_customer_summary', JSON.stringify(customer));
  };

  const generateNew = (customer: any) => { startFor(customer); navigate('/customer/photo'); };

  const repeat = async (customer: any, style: RepeatableStyle) => {
    startFor(customer);
    await preparePreviousStyle(style, customer.id);
    navigate('/customer/instructions');
  };

  const continuePrevious = async (customer: any, target: ContinueTarget) => {
    if (target.kind === 'style') return repeat(customer, target.style);
    if (target.kind === 'photo') {
      startFor(customer);
      applyPreviousPhotoSession(target.photo);
      navigate('/customer/service');
    }
  };

  if (adding) {
    return (
      <div className="auth-rise mx-auto w-full max-w-3xl rounded-3xl border border-[#dfe7e1] bg-[#ffffff] p-6 shadow-[0_24px_60px_-30px_rgba(36,74,55,0.3)] sm:p-8">
        <AddCustomerForm initialQuery={searchQuery} onCancel={() => setAdding(false)}
          onCreated={(c) => { setAdding(false); setSearchQuery(''); setSelected({ ...c, customer_type: 'Regular', frequent_services: [], branches_visited: [] }); }} />
      </div>
    );
  }

  if (selected) {
    const target = continueTarget(history, selected.previous_style);
    const action = 'group flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-all active:scale-[0.99] cursor-pointer';
    return (
      <div className="auth-rise space-y-5">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-2 text-sm font-semibold text-[#4f6b5a] transition-colors hover:text-[#1a2a20] cursor-pointer">
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to customer directory
        </button>

        <div className="grid items-start gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
          {/* LEFT: who + what to do */}
          <aside className="space-y-3 lg:sticky lg:top-24">
            <ProfileCard profile={selected} compact />

            <div className="space-y-2">
              <button type="button" onClick={() => generateNew(selected)}
                className={`${action} bg-gradient-to-br from-[#244a37] to-[#2f5d46] shadow-lg shadow-[#244a37]/25 hover:shadow-xl`}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#ffffff]/15 text-[#f3d27a]"><Sparkles aria-hidden="true" className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-[#ffffff]">Generate new style</span>
                  <span className="block text-xs text-[#ffffff]/70">New photos &amp; new looks</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 text-[#ffffff]/80 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button type="button" onClick={() => continuePrevious(selected, target)} disabled={target.kind === 'none'}
                className={`${action} border border-[#dfe7e1] bg-[#ffffff] hover:border-[#c3d3c9] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50`}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e4eee7] text-[#2f5d46]"><UserCheck aria-hidden="true" className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-[#1a2a20]">Continue previous style</span>
                  <span className="line-clamp-1 block text-xs text-[#6c7e73]">{target.hint}</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 text-[#a3b3a9] transition-transform group-hover:translate-x-0.5" />
              </button>
              <button type="button" onClick={() => setShowFullProfile((v) => !v)}
                className={`${action} border ${showFullProfile ? 'border-[#2f6f9f]/40 bg-[#f3f8fb]' : 'border-[#dfe7e1] bg-[#ffffff]'} hover:border-[#c3d3c9] hover:shadow-md`}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e8f1f7] text-[#2f6f9f]"><IdCard aria-hidden="true" className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-[#1a2a20]">{showFullProfile ? 'Show summary' : 'View full profile'}</span>
                  <span className="block text-xs text-[#6c7e73]">{showFullProfile ? 'Back to the quick view' : 'History, styles and gallery'}</span>
                </span>
              </button>
            </div>

            <div className="space-y-2 rounded-2xl border border-[#dfe7e1] bg-[#fafcfa] p-3.5">
              <button type="button" onClick={() => resetPassword(selected)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold text-[#33483c] hover:text-[#1a2a20] cursor-pointer">
                <KeyRound aria-hidden="true" className="size-4 shrink-0 text-[#a3762a]" /> Forgot password? Issue a one-time password
              </button>
              {oneTimePassword && (
                <p className="text-xs text-[#4f6b5a]">Shown once: <b className="select-all rounded-lg bg-[#fdf3d7] px-2 py-1 font-mono text-sm text-[#5c430a]">{oneTimePassword}</b></p>
              )}
              {resetError && <p role="alert" className="text-xs text-rose-700">{resetError}</p>}
            </div>
          </aside>

          {/* RIGHT: looks */}
          <div className="min-w-0 space-y-5">
            {showFullProfile ? (
              <CustomerFullProfile customerId={selected.id} onRepeat={(s) => repeat(selected, s)} hideProfileCard />
            ) : (
              <>
                <LatestLookCard history={history} />
                <section className="space-y-3 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-5">
                  <h3 className="text-sm font-bold text-[#1a2a20]">Previously selected styles</h3>
                  {history ? <PreviousStylesStrip history={history} onRepeat={(s) => repeat(selected, s)} limit={8} />
                    : <p className="flex items-center gap-2 text-xs text-[#6c7e73]"><RefreshCw className="size-4 animate-spin" /> Loading styles…</p>}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const noMatch = !loading && customers.length === 0;
  return (
    <div className="auth-rise space-y-5">
      {/* Header band */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-6 shadow-[0_24px_60px_-30px_rgba(36,74,55,0.45)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">Customer directory</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#ffffff]">Who are you serving?</h2>
            <p className="mt-1 text-[13px] text-[#ffffff]/75">Signed in as {session?.name} ({session?.role}). Search, then pick the customer.</p>
          </div>
          <button type="button" onClick={() => setAdding(true)}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#f3d27a] px-5 text-sm font-bold text-[#1d3d2d] shadow-lg shadow-black/20 transition-all hover:bg-[#f0c95f] active:scale-[0.98] cursor-pointer">
            <UserPlus aria-hidden="true" className="size-4" /> Add new customer
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="space-y-3 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-4">
        <div className="group relative">
          <label htmlFor="customer-search" className="sr-only">Search customer</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#7f968a] group-focus-within:text-[#2f5d46]" />
          <input id="customer-search" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Mobile number, customer ID (e.g. CUST-1001) or name"
            className="h-12 w-full rounded-xl border border-[#c3d3c9] bg-[#ffffff] pl-12 pr-11 text-base text-[#1a2a20] placeholder-[#8b9a92] transition-all hover:border-[#9db5a6] focus:border-[#2f5d46] focus:outline-none focus:ring-4 focus:ring-[#2f5d46]/12" />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search"
              className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#7f968a] hover:bg-[#eef3ee] hover:text-[#1a2a20] cursor-pointer">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl bg-[#eef3ee] p-1" role="tablist" aria-label="Which customers">
              {[{ all: false, label: 'This branch' }, { all: true, label: 'All branches' }].map((tb) => (
                <button key={tb.label} type="button" role="tab" aria-selected={allBranches === tb.all} onClick={() => setAllBranches(tb.all)}
                  className={`h-8 rounded-lg px-3.5 text-xs font-semibold transition-all cursor-pointer ${
                    allBranches === tb.all ? 'bg-[#ffffff] text-[#1a2a20] shadow-sm' : 'text-[#4f6b5a] hover:text-[#1a2a20]'
                  }`}>
                  {tb.label}
                </button>
              ))}
            </div>
            {!allBranches && <BranchSelector />}
          </div>
          <p className="flex items-center gap-2 text-xs text-[#7f968a]" aria-live="polite">
            {loading && <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />}
            {!loading && `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}`}
            {!loading && !allBranches && ' · registered at or visiting this branch, plus new customers'}
          </p>
        </div>
      </div>

      {loading && customers.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-[#f3f6f4]" />)}
        </div>
      ) : noMatch ? (
        <div className="space-y-4 rounded-2xl border border-dashed border-[#c3d3c9] bg-[#fafcfa] px-6 py-12 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#e4eee7] text-[#2f5d46]"><UserPlus aria-hidden="true" className="size-6" /></span>
          <div>
            <p className="font-bold text-[#1a2a20]">No customer found{allBranches ? '' : ' at this branch'}</p>
            <p className="mt-1 text-xs text-[#6c7e73]">Check the mobile number or customer ID, or register this customer.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {!allBranches && (
              <button type="button" onClick={() => setAllBranches(true)}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#c3d3c9] bg-[#ffffff] px-5 text-sm font-semibold text-[#2f5d46] hover:border-[#2f5d46] cursor-pointer">
                <Search aria-hidden="true" className="size-4" /> Search all branches
              </button>
            )}
            <button type="button" onClick={() => setAdding(true)}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#244a37] px-5 text-sm font-semibold text-[#ffffff] shadow-md hover:bg-[#1b392b] cursor-pointer">
              <UserPlus aria-hidden="true" className="size-4" /> Add new customer
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {customers.map((c) => (
            <DirectoryCard key={c.id} c={c} showBranchVisits={!!scopeBranch} onOpen={() => setSelected(c)} />
          ))}
        </div>
      )}
    </div>
  );
};
