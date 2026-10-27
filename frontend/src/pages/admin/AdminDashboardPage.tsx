import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Calendar, BarChart3, Tag, Scissors, ArrowRight, IndianRupee, UserSearch, AlertCircle, Clock, Receipt } from 'lucide-react';
import { getCapacityAnalytics, getDashboardOverview } from '../../api/client';
import { getSession } from '../../auth/session';

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Placeholder bar shown while a number is loading (never a made-up value). */
const Skeleton: React.FC<{ w?: string; h?: string }> = ({ w = 'w-20', h = 'h-7' }) => (
  <span className={`inline-block ${h} ${w} animate-pulse rounded-lg bg-[#eef3ee]`} />
);

/** Completed visits per weekday (single series, one hue); busiest day is labelled, every bar has a hover tooltip. */
const VisitsByDay: React.FC<{ counts: number[] | null }> = ({ counts }) => {
  if (!counts) return <div className="h-52 animate-pulse rounded-xl bg-[#f6faf7]" />;
  const max = Math.max(...counts);
  if (!max) {
    return (
      <div className="grid h-52 place-items-center rounded-xl bg-[#fafcfa] text-center text-xs text-[#8a9a92]">
        No visit times recorded in the last 90 days yet.
      </div>
    );
  }
  const busiest = counts.indexOf(max);
  return (
    <figure>
      <div className="relative h-52">
        {/* recessive grid: top and middle lines with their values */}
        {[1, 0.5].map((f) => (
          <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#ebf0ec]" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -top-2.5 right-0 bg-[#ffffff] pl-1 text-[10px] tabular-nums text-[#a3b3a9]">{Math.round(max * f)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-2 border-b border-[#dfe7e1] pr-6 sm:gap-3">
          {counts.map((n, i) => (
            <div key={DAYS[i]} className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0} aria-label={`${DAYS[i]}: ${n} visits`}>
              {/* tooltip */}
              <span className="pointer-events-none absolute z-10 -translate-y-2 whitespace-nowrap rounded-lg bg-[#1a2a20] px-2.5 py-1.5 text-[11px] font-semibold text-[#ffffff] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                style={{ bottom: `${(n / max) * 100}%` }}>
                {DAYS[i]} · {n} {n === 1 ? 'visit' : 'visits'}
              </span>
              {i === busiest && (
                <span className="absolute -translate-y-1 text-center text-[10px] font-semibold leading-tight text-[#33483c] group-hover:opacity-0" style={{ bottom: `${(n / max) * 100}%` }}>
                  {n}<span className="block font-medium text-[#8a9a92]">Busiest</span>
                </span>
              )}
              <div
                className="w-full max-w-12 rounded-t-[4px] bg-[#2f5d46] transition-all duration-500 group-hover:bg-[#244a37]"
                style={{ height: `${Math.max(2, (n / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-2 pr-6 sm:gap-3">
        {DAYS.map((d, i) => (
          <span key={d} className={`flex-1 text-center text-[11px] ${i === busiest ? 'font-semibold text-[#1a2a20]' : 'text-[#7f968a]'}`}>{d.slice(0, 3)}</span>
        ))}
      </div>
      {/* table view for screen readers */}
      <table className="sr-only">
        <caption>Completed visits by day of the week, last 90 days</caption>
        <tbody>{DAYS.map((d, i) => <tr key={d}><th scope="row">{d}</th><td>{counts[i]}</td></tr>)}</tbody>
      </table>
    </figure>
  );
};

export const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [capacity, setCapacity] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const name = getSession()?.name || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    getDashboardOverview().then(setData).catch((err) => { console.error(err); setFailed(true); });
    getCapacityAnalytics().then(setCapacity).catch((err) => console.error(err));
  }, []);

  const util = Number(data?.capacity_utilization_pct ?? 0);
  const dayCounts: number[] | null = capacity?.heatmap
    ? DAYS.map((d) => capacity.heatmap.filter((c: any) => c.day === d).reduce((s: number, c: any) => s + (c.traffic || 0), 0))
    : null;

  const kpis = [
    { label: 'Total revenue', value: data && inr(data.total_revenue), sub: 'After discounts', Icon: IndianRupee, tone: 'bg-[#e4eee7] text-[#2f5d46]' },
    { label: 'Visits', value: data && String(data.total_visits), sub: 'Completed services', Icon: Calendar, tone: 'bg-[#e3f3f1] text-[#23847a]' },
    { label: 'Average per visit', value: data && inr(data.avg_spending), sub: 'Revenue ÷ visits', Icon: Receipt, tone: 'bg-[#fdf3d7] text-[#a3762a]' },
    { label: 'Customers', value: data && String(data.total_customers), sub: 'In the directory', Icon: Users, tone: 'bg-[#e8f1f7] text-[#2f6f9f]' },
  ];

  const tools = [
    { title: 'Day vs hour heatmap', desc: 'Peak and lean hours across the week', to: '/admin/analytics/capacity', Icon: BarChart3, tone: 'bg-[#e3f3f1] text-[#23847a]' },
    { title: 'RFM customer intelligence', desc: 'Segments, recency, frequency and churn risk', to: '/admin/customers', Icon: Users, tone: 'bg-[#e8f1f7] text-[#2f6f9f]' },
    { title: 'Automated discount engine', desc: 'Personal coupons that respect your margins', to: '/admin/campaigns', Icon: Tag, tone: 'bg-[#fdf3d7] text-[#a3762a]' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-[#7f968a]">{today}</p>
          <h1 className="mt-0.5 break-words text-2xl font-bold tracking-tight text-[#1a2a20] sm:text-3xl">{greeting}, {name.split(' ')[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate('/stylist/customers')}
            className="flex h-10 items-center gap-2 rounded-xl border border-[#dfe7e1] bg-[#ffffff] px-4 text-sm font-semibold text-[#2f5d46] transition-colors hover:border-[#c3d3c9] hover:bg-[#f2f7f3] cursor-pointer"
          >
            <UserSearch aria-hidden="true" className="size-4" /> Serve a customer
          </button>
          <button
            onClick={() => navigate('/customer/login')}
            className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] px-4 text-sm font-semibold text-[#ffffff] shadow-md shadow-[#244a37]/20 transition-all hover:from-[#1b392b] hover:to-[#244a37] cursor-pointer"
          >
            <Scissors aria-hidden="true" className="size-4" /> Open customer portal
          </button>
        </div>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle aria-hidden="true" className="size-4" /> Could not load the dashboard numbers. Please check that the backend is running.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff] sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, sub, Icon, tone }, i) => (
          <div
            key={label}
            className={`flex items-center gap-4 p-5 ${i ? 'border-t border-[#ebf0ec] sm:border-t-0' : ''} ${i % 2 ? 'sm:border-l' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''} ${i === 2 ? 'lg:border-l' : ''} border-[#ebf0ec]`}
          >
            <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${tone}`}>
              <Icon aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#7f968a]">{label}</p>
              <p className="truncate text-2xl font-bold tabular-nums text-[#1a2a20]">{value ?? <Skeleton />}</p>
              <p className="truncate text-[11px] text-[#a3b3a9]">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Chart + utilisation */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-5 lg:col-span-2">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#1a2a20]">Visits by day</h2>
              <p className="text-xs text-[#7f968a]">Completed visits in the last 90 days</p>
            </div>
            <button onClick={() => navigate('/admin/analytics/capacity')} className="flex items-center gap-1 text-xs font-semibold text-[#2f5d46] hover:underline underline-offset-4 cursor-pointer">
              Heatmap <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          </div>
          <VisitsByDay counts={dayCounts} />
        </section>

        <section className="flex flex-col gap-5 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-5">
          <div>
            <h2 className="text-sm font-bold text-[#1a2a20]">Chair utilisation</h2>
            <p className="text-xs text-[#7f968a]">Average over the last 90 days</p>
            <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-[#1a2a20]">{data ? `${util}%` : <Skeleton w="w-24" h="h-10" />}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eef3ee]" role="meter" aria-valuenow={util} aria-valuemin={0} aria-valuemax={100} aria-label="Chair utilisation">
              <div className="h-full rounded-full bg-[#2f5d46] transition-all duration-700" style={{ width: `${Math.min(100, util)}%` }} />
            </div>
          </div>

          <dl className="space-y-3 border-t border-[#ebf0ec] pt-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-[#7f968a]"><Clock aria-hidden="true" className="size-3.5" /> Peak hours</dt>
              <dd className="text-right font-semibold text-[#1a2a20]">{capacity ? (capacity.peak_hours?.length ? capacity.peak_hours.join(', ') : 'Not enough data') : '—'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-[#7f968a]"><Clock aria-hidden="true" className="size-3.5" /> Lean hours</dt>
              <dd className="text-right font-semibold text-[#1a2a20]">{capacity ? (capacity.lean_hours?.[0] || '—') : '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-[#7f968a]"><Tag aria-hidden="true" className="size-3.5" /> Active campaigns</dt>
              <dd className="font-semibold text-[#1a2a20]">{data ? data.active_campaigns_count : '—'}</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Tools */}
      <section className="overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff]">
        <h2 className="border-b border-[#ebf0ec] px-5 py-3.5 text-sm font-bold text-[#1a2a20]">Insights &amp; tools</h2>
        <div className="divide-y divide-[#ebf0ec]">
          {tools.map(({ title, desc, to, Icon, tone }) => (
            <button
              key={title}
              onClick={() => navigate(to)}
              className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[#f6faf7] cursor-pointer"
            >
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}>
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold capitalize text-[#1a2a20]">{title}</span>
                <span className="block truncate text-xs text-[#6c7e73]">{desc}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#a3b3a9] transition-transform group-hover:translate-x-0.5 group-hover:text-[#2f5d46]" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
