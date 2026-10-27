import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Volume2, ArrowRight, Info, Clock } from 'lucide-react';

type Status = 'IN_PROGRESS' | 'WAITING' | 'SCHEDULED';

const STATUS: Record<Status, { label: string; chip: string; dot: string }> = {
  IN_PROGRESS: { label: 'In service', chip: 'bg-[#e4eee7] text-[#244a37]', dot: 'bg-[#2f5d46] ring-4 ring-[#2f5d46]/15' },
  WAITING: { label: 'Waiting', chip: 'bg-[#fdf3d7] text-[#7a5a0c]', dot: 'bg-[#e9b949] ring-4 ring-[#e9b949]/20' },
  SCHEDULED: { label: 'Scheduled', chip: 'bg-[#f1f4f1] text-[#6c7e73]', dot: 'border-2 border-[#c3d3c9] bg-[#ffffff]' },
};

export const StylistDashboardPage: React.FC = () => {
  const navigate = useNavigate();

  // Sample queue: appointment booking is not connected to the backend yet (no appointments API)
  const appointments: { id: number; customer: string; service: string; style: string; time: string; status: Status }[] = [
    { id: 1, customer: 'Alex Mercer', service: 'Haircut & Styling', style: 'Low Taper Fade + Textured Top', time: '10:30 AM', status: 'IN_PROGRESS' },
    { id: 2, customer: 'Rohan Kapoor', service: 'Beard Trim & Sculpting', style: 'Sharp Boxed Beard', time: '11:15 AM', status: 'WAITING' },
    { id: 3, customer: 'David Miller', service: 'Haircut + Facial', style: 'Corporate Ivy League Crop', time: '12:00 PM', status: 'SCHEDULED' },
  ];
  const counts = (Object.keys(STATUS) as Status[]).map((s) => ({ s, n: appointments.filter((a) => a.status === s).length }));
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="auth-rise space-y-5">
      {/* Header band */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-6 shadow-[0_24px_60px_-30px_rgba(36,74,55,0.45)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">{today}</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#ffffff]">Today's queue</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {counts.map(({ s, n }) => (
                <span key={s} className="rounded-full bg-[#ffffff]/10 px-3 py-1 text-xs font-semibold text-[#ffffff] ring-1 ring-[#ffffff]/15">
                  {n} {STATUS[s].label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => navigate('/customer/instructions')}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#ffffff] px-5 text-sm font-semibold text-[#1d3d2d] shadow-lg shadow-black/15 transition-all hover:bg-[#f2f8f4] active:scale-[0.98] cursor-pointer"
          >
            <Volume2 aria-hidden="true" className="size-4 text-[#2f5d46]" /> Cutting audio player
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-[#e9d9a8] bg-[#fdf8e8] px-4 py-3 text-xs text-[#6b5a22]">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#8a6d12]" />
        Sample queue for preview: appointment booking is not connected yet, so these are not real bookings.
      </p>

      {/* Timeline */}
      <ol className="relative space-y-3">
        {appointments.map((app, i) => {
          const st = STATUS[app.status];
          const now = app.status === 'IN_PROGRESS';
          return (
            <li key={app.id} className="relative grid grid-cols-[4.5rem_1fr] gap-3 sm:grid-cols-[5.5rem_1fr] sm:gap-4">
              {/* time + rail */}
              <div className="relative flex flex-col items-end pt-5 pr-5">
                <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-[#1a2a20]">{app.time.replace(' ', ' ')}</span>
                <span aria-hidden="true" className={`absolute right-0 top-6 size-3 -translate-y-1/2 translate-x-1/2 rounded-full ${st.dot}`} />
                {i < appointments.length - 1 && (
                  <span aria-hidden="true" className="absolute right-0 top-9 -bottom-3 w-px translate-x-1/2 bg-[#dfe7e1]" />
                )}
              </div>

              {/* card */}
              <div className={`flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${
                now ? 'border-[#2f5d46]/40 bg-[#f6faf7] shadow-md shadow-[#244a37]/10' : 'border-[#dfe7e1] bg-[#ffffff]'
              }`}>
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${now ? 'bg-[#244a37] text-[#f3d27a]' : 'bg-[#e4eee7] text-[#2f5d46]'}`}>
                    <Scissors aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-bold text-[#1a2a20]">{app.customer}</h3>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.chip}`}>
                        {now && <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-[#2f5d46]" />}
                        {app.status === 'WAITING' && <Clock aria-hidden="true" className="size-3" />}
                        {st.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#6c7e73]">{app.service}</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#33483c]">{app.style}</p>
                  </div>
                </div>

                <button
                  onClick={() => navigate('/customer/instructions')}
                  className={`flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all active:scale-[0.98] cursor-pointer ${
                    now
                      ? 'bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-[#ffffff] shadow-md shadow-[#244a37]/20 hover:from-[#1b392b]'
                      : 'border border-[#dfe7e1] bg-[#ffffff] text-[#2f5d46] hover:border-[#2f5d46] hover:bg-[#f2f8f4]'
                  }`}
                >
                  Cutting instructions <ArrowRight aria-hidden="true" className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
