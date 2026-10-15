import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, UserPlus, Phone, ChevronRight, ArrowLeft, UserCheck, Sparkles, IdCard, KeyRound } from 'lucide-react';
import { getCustomerHistory, getCustomers, resetCustomerPassword, type CustomerHistory } from '../../api/client';
import { CustomerSummaryCard } from '../../components/CustomerInsights';
import { CustomerFullProfile, LatestLookCard, PreviousStylesStrip, type RepeatableStyle } from '../../components/CustomerFullProfile';
import { AddCustomerForm } from '../../components/AddCustomerForm';
import { BranchSelector } from '../../components/BranchSelector';
import { clearCustomerContext, getSession } from '../../auth/session';
import { preparePreviousStyle } from '../../utils/previousStyle';
import { applyPreviousPhotoSession, continueTarget, type ContinueTarget } from '../../utils/continueStyle';

import { workBranchId } from '../../utils/workBranch';

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
      <div className="bg-slate-800/90 border border-slate-700/70 rounded-2xl p-6 sm:p-8 shadow-sm">
        <AddCustomerForm initialQuery={searchQuery} onCancel={() => setAdding(false)}
          onCreated={(c) => { setAdding(false); setSearchQuery(''); setSelected({ ...c, customer_type: 'Regular', frequent_services: [], branches_visited: [] }); }} />
      </div>
    );
  }

  if (selected) {
    const target = continueTarget(history, selected.previous_style);
    return (
      <div className="bg-slate-800/90 border border-slate-700/70 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <button type="button" onClick={() => setSelected(null)} className="flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Customer Directory</span>
        </button>

        {showFullProfile ? (
          <CustomerFullProfile customerId={selected.id} onRepeat={(s) => repeat(selected, s)} />
        ) : (
          <>
            <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20">
              <CustomerSummaryCard customer={selected} />
            </div>

            <LatestLookCard history={history} />

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Previously Selected Styles</h3>
              {history ? <PreviousStylesStrip history={history} onRepeat={(s) => repeat(selected, s)} limit={4} />
                : <p className="text-xs text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading styles...</p>}
            </div>
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button type="button"
            onClick={() => continuePrevious(selected, target)}
            disabled={target.kind === 'none'}
            className="p-4 rounded-2xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold flex flex-col items-center justify-center gap-1 touch-target-large active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
            <UserCheck className="w-6 h-6 text-amber-400" />
            <span>Continue Previous Style</span>
            <span className="text-[11px] font-medium text-slate-300 text-center line-clamp-2">{target.hint}</span>
          </button>
          <button type="button" onClick={() => generateNew(selected)}
            className="p-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold flex flex-col items-center justify-center gap-1 touch-target-large active:scale-95 shadow-sm">
            <Sparkles className="w-6 h-6" />
            <span>Generate New Style</span>
            <span className="text-[11px] font-medium text-slate-800">New photos & new looks</span>
          </button>
          <button type="button" onClick={() => setShowFullProfile((v) => !v)}
            className="p-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95">
            <IdCard className="w-6 h-6 text-sky-400" />
            <span>{showFullProfile ? 'Show Summary' : 'View Full Profile'}</span>
          </button>
        </div>

        <div className="pt-2 border-t border-slate-700/60 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => resetPassword(selected)}
            className="min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400" /> Forgot password? Issue one-time password
          </button>
          {oneTimePassword && (
            <span className="text-sm text-slate-300">One-time password (shown once): <b className="font-mono text-amber-300 select-all">{oneTimePassword}</b></span>
          )}
          {resetError && <span role="alert" className="text-sm text-rose-300">{resetError}</span>}
        </div>
      </div>
    );
  }

  const noMatch = !loading && customers.length === 0;
  return (
    <div className="bg-slate-800/90 border border-slate-700/70 rounded-2xl p-6 sm:p-8 shadow-sm">
      <div className="pb-6 mb-6 border-b border-slate-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Customer Directory</h2>
          <p className="text-xs text-slate-400 mt-1">Signed in as {session?.name} ({session?.role}). Select the customer you are serving.</p>
        </div>
        <BranchSelector />
      </div>

      <div className="mb-4 inline-flex p-1 rounded-xl bg-slate-900 border border-slate-700" role="tablist" aria-label="Which customers">
        {[{ all: false, label: 'This branch' }, { all: true, label: 'All branches' }].map((t) => (
          <button key={t.label} type="button" role="tab" aria-selected={allBranches === t.all} onClick={() => setAllBranches(t.all)}
            className={`min-h-[40px] px-4 rounded-lg text-sm font-bold ${allBranches === t.all ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mb-4 -mt-2">
        {allBranches ? 'Showing customers from every branch.' : 'Customers registered at or visiting this branch, plus new customers without a branch yet.'}
      </p>

      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="customer-search" className="sr-only">Search customer</label>
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input id="customer-search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Mobile number or customer ID (e.g. CUST-1001), or name..."
            className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-3.5 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-base" />
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="min-h-[52px] px-5 rounded-2xl bg-slate-900 hover:bg-slate-700 border border-amber-500/40 text-amber-300 font-bold flex items-center justify-center gap-2">
          <UserPlus className="w-5 h-5" /> Add New Customer
        </button>
      </div>

      {loading && customers.length === 0 ? (
        <div className="py-12 text-center text-slate-400 flex flex-col items-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
          <span>Loading customer directory...</span>
        </div>
      ) : noMatch ? (
        <div className="py-12 text-center bg-slate-900/60 rounded-2xl border border-slate-700/50 p-6 space-y-4">
          <UserPlus className="w-12 h-12 text-slate-500 mx-auto" />
          <div>
            <p className="text-white font-bold">No customer found{allBranches ? '' : ' at this branch'}</p>
            <p className="text-xs text-slate-400 mt-1">Check the mobile number or customer ID, or register this customer.</p>
          </div>
          {!allBranches && (
            <button type="button" onClick={() => setAllBranches(true)}
              className="min-h-[52px] px-6 mr-3 rounded-2xl bg-slate-800 border border-slate-700 text-slate-200 font-bold inline-flex items-center gap-2">
              <Search className="w-5 h-5" /> Search all branches
            </button>
          )}
          <button type="button" onClick={() => setAdding(true)}
            className="min-h-[52px] px-6 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold inline-flex items-center gap-2">
            <UserPlus className="w-5 h-5" /> Add New Customer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {customers.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelected(c)}
              className="relative h-full text-left p-4 pr-10 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-700/70 hover:border-amber-500/60 transition-all flex flex-col">
              <ChevronRight className="absolute top-5 right-3 w-5 h-5 text-amber-400" />
              <CustomerSummaryCard customer={c} footer={
                <div className="space-y-1">
                  <p className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2">
                    {c.home_branch ? <span>Home branch: <b className="text-slate-300">{c.home_branch}</b></span>
                      : <span className="font-semibold text-amber-300">New — no branch yet</span>}
                    {scopeBranch && c.visits_at_branch ? <span>• {c.visits_at_branch} {c.visits_at_branch === 1 ? 'visit' : 'visits'} here</span> : null}
                  </p>
                  {c.matched_by_phone && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1"><Phone className="w-3 h-3" /><span>Matched mobile number</span></p>
                  )}
                </div>
              } />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
