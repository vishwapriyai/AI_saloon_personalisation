import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, UserPlus, Phone, ChevronRight, ArrowLeft, UserCheck, Sparkles } from 'lucide-react';
import { getCustomers } from '../../api/client';
import { clearCustomerContext, getSession } from '../../auth/session';
import { preparePreviousStyle } from '../../utils/previousStyle';

/** Staff home: find the customer being served, then continue their previous style or create a new one. */
export const StaffCustomersPage: React.FC = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [customers, setCustomers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      getCustomers(searchQuery.trim() || undefined)
        .then((data) => { if (active) setCustomers(Array.isArray(data) ? data : []); })
        .catch((err) => console.error('Failed to load customers:', err))
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [searchQuery]);

  const serve = async (customer: any, next: '/customer/instructions' | '/customer/photo') => {
    clearCustomerContext(); // the previous customer's session data must not carry over
    localStorage.setItem('salon_customer_id', String(customer.id));
    localStorage.setItem('salon_customer_name', customer.full_name);
    localStorage.setItem('salon_customer_summary', JSON.stringify(customer));
    if (next === '/customer/instructions' && customer.previous_style) await preparePreviousStyle(customer.previous_style);
    navigate(next);
  };

  if (selected) {
    return (
      <div className="bg-slate-800/90 border border-slate-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        <button type="button" onClick={() => setSelected(null)} className="flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Customer Directory</span>
        </button>

        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-800 border border-amber-500/30 flex-shrink-0 flex items-center justify-center text-xl">
            {selected.avatar_url ? <img src={selected.avatar_url} alt={selected.full_name} className="w-full h-full object-cover" />
              : <span className="text-amber-400 font-bold">{selected.full_name[0]}</span>}
          </div>
          <div>
            <h3 className="font-bold text-lg text-white flex items-center gap-2">
              <span>{selected.full_name}</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-amber-300">{selected.customer_code}</span>
            </h3>
            <p className="text-xs text-amber-400 font-semibold mt-0.5">{selected.segment_name} • {selected.total_visits} Visits</p>
          </div>
        </div>

        {selected.previous_style?.reference_image_url && (
          <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Previous Selected Hairstyle</p>
            <div className="relative mx-auto h-72 sm:h-80 aspect-[4/5] max-w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/60">
              <img src={selected.previous_style.reference_image_url} alt="Previous Style" className="w-full h-full object-contain" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent flex items-end p-3">
                <span className="text-xs font-bold text-amber-300">{selected.previous_style?.hairstyle_name || 'Previous Selected Hairstyle'}</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {selected.previous_style?.reference_image_url && (
            <button type="button" onClick={() => serve(selected, '/customer/instructions')}
              className="p-4 rounded-2xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95">
              <UserCheck className="w-6 h-6 text-amber-400" />
              <span>Continue Previous Style</span>
            </button>
          )}
          <button type="button" onClick={() => serve(selected, '/customer/photo')}
            className={`p-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 shadow-lg shadow-amber-500/20 ${selected.previous_style?.reference_image_url ? '' : 'sm:col-span-2'}`}>
            <Sparkles className="w-6 h-6" />
            <span>Generate New Style</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/90 border border-slate-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl">
      <div className="pb-6 mb-6 border-b border-slate-700/60">
        <h2 className="text-xl font-bold text-white">Customer Directory</h2>
        <p className="text-xs text-slate-400 mt-1">Signed in as {session?.name} ({session?.role}). Select the customer you are serving.</p>
      </div>

      <div className="mb-6">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Search Customer Directory</label>
        <div className="relative">
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name, mobile number or customer ID (e.g. CUST-1001)..."
            className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-3.5 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-base" />
        </div>
      </div>

      {loading && customers.length === 0 ? (
        <div className="py-12 text-center text-slate-400 flex flex-col items-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
          <span>Loading customer directory...</span>
        </div>
      ) : customers.length === 0 ? (
        <div className="py-12 text-center bg-slate-900/60 rounded-2xl border border-slate-700/50 p-6">
          <UserPlus className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <p className="text-white font-bold">No customers found</p>
          <p className="text-xs text-slate-400 mt-1">Try a different mobile number, customer ID or name.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {customers.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelected(c)}
              className="text-left p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-700/70 hover:border-amber-500/60 transition-all group flex items-center justify-between">
              <div className="flex items-center space-x-3.5 min-w-0">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center text-xl">
                  {c.avatar_url ? <img src={c.avatar_url} alt={c.full_name} className="w-full h-full object-cover" />
                    : <span className="text-amber-400 font-bold">{c.full_name[0]}</span>}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-white text-base truncate group-hover:text-amber-400">{c.full_name}</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300 flex-shrink-0">{c.customer_code}</span>
                  </div>
                  {c.matched_by_phone && (
                    <p className="text-xs text-emerald-400 flex items-center space-x-1 mt-1"><Phone className="w-3 h-3" /><span>Matched mobile number</span></p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">{c.segment_name} • {c.total_visits} Visits</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-amber-400 flex-shrink-0 ml-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
