import React, { useEffect, useState } from 'react';
import { Award, ShieldCheck, Clock, RefreshCw } from 'lucide-react';
import { getCustomerProfile, type CustomerProfile } from '../../api/client';
import { currentCustomerId } from '../../auth/session';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

/** The logged-in customer's own profile: real ID, segment, visits, loyalty points and membership. */
export const CustomerProfilePage: React.FC = () => {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCustomerProfile(currentCustomerId())
      .then((p) => { if (active) setProfile(p); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load your profile'); });
    return () => { active = false; };
  }, []);

  if (error) {
    return (
      <div className="flex-1 py-4">
        <div role="alert" className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center py-12 text-slate-400 gap-3">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-500" /> Loading your profile...
      </div>
    );
  }

  const lastVisit = formatDate(profile.last_visit_date);
  const memberSince = formatDate(profile.member_since);

  return (
    <div className="flex-1 space-y-6 py-4">
      <div className="bg-slate-800/80 p-6 sm:p-8 rounded-3xl border border-slate-700/60 backdrop-blur-xl flex items-center space-x-5">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-bold text-3xl flex items-center justify-center shadow-xl flex-shrink-0">
          {profile.full_name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{profile.full_name}</h2>
            {profile.membership && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
                {profile.membership.name}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {profile.segment_name} • Customer ID #{profile.customer_code}
          </p>
          {(lastVisit || memberSince) && (
            <p className="text-xs text-slate-500 mt-1">
              {lastVisit ? `Last visit ${lastVisit}` : 'No visits yet'}{memberSince ? ` • Customer since ${memberSince}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Loyalty Points</p>
            <h3 className="text-2xl font-bold text-white">{profile.loyalty_points} Points</h3>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center flex-shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Total Visits</p>
            <h3 className="text-2xl font-bold text-white">{profile.total_visits} {profile.total_visits === 1 ? 'Visit' : 'Visits'}</h3>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-3xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase">Membership</p>
            <h3 className="text-2xl font-bold text-white">{profile.membership ? profile.membership.name : 'Not a member'}</h3>
            {profile.membership?.valid_until && (
              <p className="text-[11px] text-slate-400">Valid until {formatDate(profile.membership.valid_until)}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
