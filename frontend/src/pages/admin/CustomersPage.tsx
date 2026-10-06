import React, { useEffect, useState } from 'react';
import { Search, AlertTriangle, ShieldCheck, Phone } from 'lucide-react';
import { getCustomers } from '../../api/client';

interface DirectoryCustomer {
  id: number;
  customer_code: string;
  full_name: string;
  segment_name: string;
  total_visits: number;
  total_spent: number;
  matched_by_phone?: boolean;
}

// Churn risk shown from the customer's segment until the churn model is connected
const riskOf = (segment: string) => (/rare|at-risk|inactive/i.test(segment) ? 'HIGH' : 'LOW');

export const CustomersPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [customers, setCustomers] = useState<DirectoryCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  // Search runs on the server (name, mobile number or customer ID); phone numbers are never sent to the page
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      getCustomers(searchTerm.trim() || undefined)
        .then((data) => { if (active) setCustomers(Array.isArray(data) ? data : []); })
        .catch((err) => console.error('Failed to load customers:', err))
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Customer Intelligence & Segments</h1>
          <p className="text-slate-400 text-xs sm:text-sm">RFM Segmentation & Churn Risk Prediction Database</p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, mobile number or customer ID..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <th className="p-4">Customer</th>
                <th className="p-4">Segment</th>
                <th className="p-4">Visits</th>
                <th className="p-4">Total Spent</th>
                <th className="p-4">Churn Risk</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {loading && customers.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400 text-sm">Loading customers...</td></tr>
              )}
              {!loading && customers.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400 text-sm">No customers found. Try a different name, mobile number or customer ID.</td></tr>
              )}
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-4">
                    <div className="font-bold text-white">{c.full_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{c.customer_code}</div>
                    {c.matched_by_phone && (
                      <div className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" /> Matched mobile number
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                      {c.segment_name}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-slate-200">{c.total_visits} Visits</td>
                  <td className="p-4 font-bold text-emerald-400">₹{(c.total_spent || 0).toLocaleString()}</td>
                  <td className="p-4">
                    {riskOf(c.segment_name || '') === 'HIGH' ? (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30 flex items-center w-fit space-x-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>High Risk</span>
                      </span>
                    ) : (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30 flex items-center w-fit space-x-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Active</span>
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <button className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-400 border border-slate-700">
                      View Profile
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
