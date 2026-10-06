import React from 'react';
import { Award, ShieldCheck, Clock } from 'lucide-react';

export const CustomerProfilePage: React.FC = () => {
  const customerName = localStorage.getItem('salon_customer_name') || 'Alex Mercer';

  return (
    <div className="flex-1 space-y-6 py-4">
      <div className="bg-slate-800/80 p-6 sm:p-8 rounded-3xl border border-slate-700/60 backdrop-blur-xl flex items-center space-x-5">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-bold text-3xl flex items-center justify-center shadow-xl">
          {customerName[0]}
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{customerName}</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
              Gold Member
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">Regular Customer • Customer ID #CUST-1001</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Loyalty Points</p>
            <h3 className="text-2xl font-bold text-white">180 Points</h3>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Total Visits</p>
            <h3 className="text-2xl font-bold text-white">5 Visits</h3>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Membership Tier</p>
            <h3 className="text-2xl font-bold text-white">Gold Club</h3>
          </div>
        </div>
      </div>
    </div>
  );
};
