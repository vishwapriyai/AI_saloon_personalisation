import React from 'react';
import { CalendarCheck, IndianRupee, MapPin, Crown, Gem, Star, User, Wallet, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CustomerType } from '../api/client';
import { ServiceChip } from './ServiceIcon';

const TYPE_STYLE: Record<CustomerType, { icon: LucideIcon; cls: string }> = {
  VIP: { icon: Crown, cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  Premium: { icon: Gem, cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  Priority: { icon: Star, cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  Regular: { icon: User, cls: 'bg-slate-700/60 text-slate-200 border-slate-600' },
  New: { icon: Sparkles, cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
};

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

/** Fields shared by the directory card and the profile. */
export interface CustomerSummaryData {
  full_name: string;
  customer_code: string;
  avatar_url?: string | null;
  customer_type?: CustomerType;
  visitor_status?: 'NEW_CUSTOMER' | 'CROSS_BRANCH_VISITOR' | 'RETURNING_BRANCH_CUSTOMER';
  visitor_status_label?: string;
  home_branch_name?: string;
  total_visits: number;
  total_spent?: number;
  average_spend?: number;
  branches_visited_count?: number;
  branches_visited?: string[];
  frequent_services?: { name: string; count: number }[];
}

export const VisitorStatusBadge: React.FC<{ status?: string; label?: string; homeBranch?: string }> = ({ status, homeBranch }) => {
  if (!status) return null;
  if (status === 'CROSS_BRANCH_VISITOR') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm animate-pulse">
        🔄 <span>First Time at THIS Branch</span>
        {homeBranch && <span className="opacity-85 font-normal text-[11px]">({homeBranch})</span>}
      </span>
    );
  }
  if (status === 'NEW_CUSTOMER') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
        🆕 First-time Client
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
      ⭐ Returning Branch Client
    </span>
  );
};

export const CustomerTypeBadge: React.FC<{ type?: CustomerType }> = ({ type = 'Regular' }) => {
  const { icon: Icon, cls } = TYPE_STYLE[type] || TYPE_STYLE.Regular;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold border whitespace-nowrap ${cls}`}>
      <Icon className="w-3.5 h-3.5" /> {type} Client
    </span>
  );
};

export const CustomerAvatar: React.FC<{ name: string; url?: string | null; size?: 'md' | 'lg' }> = ({ name, url, size = 'md' }) => {
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [url]);

  return (
    <div className={`${size === 'lg' ? 'w-20 h-20 text-3xl' : 'w-14 h-14 text-xl'} rounded-2xl overflow-hidden bg-slate-800 border border-amber-500/30 flex-shrink-0 flex items-center justify-center`}>
      {url && !imgError ? (
        <img
          src={url}
          alt={name}
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-amber-400 font-bold">{name[0]?.toUpperCase() || '?'}</span>
      )}
    </div>
  );
};

/** Top services as icon chips (most used first). */
export const FrequentServices: React.FC<{ services?: { name: string; count: number }[]; showCount?: boolean }> = ({ services = [], showCount }) =>
  services.length ? (
    <div className="flex flex-wrap gap-1.5">
      {services.slice(0, 3).map((s) => <ServiceChip key={s.name} name={s.name} count={showCount ? s.count : undefined} />)}
    </div>
  ) : <p className="text-xs text-slate-500">No services recorded yet</p>;

/**
 * Compact profile card: photo, name, ID, client type, visits | branches, average | total spend,
 * top 3 services and the branches visited.
 */
export const CustomerSummaryCard: React.FC<{ customer: CustomerSummaryData; large?: boolean; showBranches?: boolean }> = ({ customer: c, large = false, showBranches = true }) => (
  <div className="space-y-3 min-w-0">
    <div className="flex items-center gap-3.5 min-w-0">
      <CustomerAvatar name={c.full_name} url={c.avatar_url} size={large ? 'lg' : 'md'} />
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={`font-bold text-white truncate ${large ? 'text-2xl' : 'text-base'}`}>{c.full_name}</h3>
          <CustomerTypeBadge type={c.customer_type} />
          <VisitorStatusBadge status={c.visitor_status} label={c.visitor_status_label} homeBranch={c.home_branch_name} />
        </div>
        <p className="text-xs text-slate-400">Customer ID: <span className="font-mono text-amber-300">{c.customer_code}</span></p>
        <p className="text-xs text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1"><CalendarCheck className="w-3.5 h-3.5 text-purple-400" /> <b>{c.total_visits}</b> Visits</span>
          <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-sky-400" /> <b>{c.branches_visited_count ?? 0}</b> {c.branches_visited_count === 1 ? 'Branch' : 'Branches'}</span>
        </p>
        <p className="text-xs text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1"><IndianRupee className="w-3.5 h-3.5 text-emerald-400" /> Avg <b>{inr(c.average_spend ?? 0)}</b></span>
          <span className="inline-flex items-center gap-1"><Wallet className="w-3.5 h-3.5 text-emerald-400" /> Total <b>{inr(c.total_spent ?? 0)}</b></span>
        </p>
      </div>
    </div>
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Frequently Used Services</p>
      <FrequentServices services={c.frequent_services} showCount={large} />
    </div>
    {showBranches && !!c.branches_visited?.length && (
      <div className="flex flex-wrap gap-1.5">
        {c.branches_visited.map((b) => (
          <span key={b} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
            <MapPin className="w-3 h-3 text-sky-400" /> {b}
          </span>
        ))}
      </div>
    )}
  </div>
);

/** Large stat tiles: visits, average spend, total spend, branches. */
export const CustomerInsights: React.FC<{ profile: CustomerSummaryData }> = ({ profile }) => {
  const stats = [
    { icon: CalendarCheck, label: 'Total Visits', value: String(profile.total_visits), cls: 'bg-purple-500/10 text-purple-400' },
    { icon: IndianRupee, label: 'Average Spend', value: inr(profile.average_spend ?? 0), cls: 'bg-emerald-500/10 text-emerald-400' },
    { icon: Wallet, label: 'Total Spend', value: inr(profile.total_spent ?? 0), cls: 'bg-emerald-500/10 text-emerald-400' },
    { icon: MapPin, label: 'Branches', value: String(profile.branches_visited_count ?? 0), cls: 'bg-sky-500/10 text-sky-400' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(({ icon: Icon, label, value, cls }) => (
        <div key={label} className="bg-slate-800/60 border border-slate-700/60 p-4 rounded-2xl flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cls}`}><Icon className="w-5 h-5" /></div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase truncate">{label}</p>
            <p className="text-xl font-bold text-white truncate">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
