import React, { useEffect, useState } from 'react';
import { Tag, Sparkles, RefreshCw, Copy, Check, Info, ShieldCheck, Percent, CalendarClock, AlertCircle, Ticket } from 'lucide-react';
import { getCustomers, recommendOffer } from '../../api/client';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 12 }, (_, i) => 9 + i); // 9 AM - 8 PM
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
// No services list API yet: offers are calculated for the catalogue's first service (shown in the result)
const SERVICE_ID = 1;

const field = 'h-11 w-full cursor-pointer rounded-xl border border-[#c3d3c9] bg-[#ffffff] px-3 text-sm font-medium text-[#1a2a20] focus:border-[#2f5d46] focus:outline-none focus:ring-4 focus:ring-[#2f5d46]/12';
const label = 'mb-1.5 block text-xs font-semibold text-[#33483c]';

export const CampaignsPage: React.FC = () => {
  const [customers, setCustomers] = useState<{ id: number; full_name: string; segment_name: string }[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [day, setDay] = useState(DAYS[(new Date().getDay() + 6) % 7]);
  const [hour, setHour] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCustomers()
      .then((list) => {
        const rows = Array.isArray(list) ? list : [];
        setCustomers(rows);
        if (rows.length) setCustomerId((id) => id ?? rows[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load customers'));
  }, []);

  const calculate = async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      setOffer(await recommendOffer({ customer_id: customerId, service_id: SERVICE_ID, requested_day: day, requested_hour: hour }));
    } catch (e) {
      setOffer(null);
      setError(e instanceof Error ? e.message : 'Could not calculate the offer');
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!offer?.coupon_code) return;
    navigator.clipboard.writeText(offer.coupon_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chosen = customers.find((c) => c.id === customerId);
  const hasDiscount = offer && Number(offer.calculated_discount_pct) > 0;
  // Price before the discount, worked back from the final price (the API returns only the final price)
  const original = hasDiscount ? Math.round(offer.final_price / (1 - Number(offer.calculated_discount_pct) / 100)) : 0;
  const validUntil = offer
    ? new Date(Date.now() + (offer.valid_until_days || 0) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header band */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-6 shadow-[0_24px_60px_-30px_rgba(36,74,55,0.45)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">Offers &amp; coupons</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#ffffff]">Personal discount engine</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[#ffffff]/75">
            Calculates a fair discount from the customer's visit history, how busy the slot is, and your profit margin.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { Icon: Percent, text: '10–40% discount range' },
              { Icon: ShieldCheck, text: 'Keeps at least 30% margin' },
              { Icon: CalendarClock, text: 'Coupons valid 5 days' },
            ].map(({ Icon, text }) => (
              <span key={text} className="inline-flex items-center gap-1.5 rounded-full bg-[#ffffff]/10 px-3 py-1 text-xs font-medium text-[#ffffff] ring-1 ring-[#ffffff]/15">
                <Icon aria-hidden="true" className="size-3.5 text-[#f3d27a]" /> {text}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* LEFT: inputs */}
        <section className="space-y-4 rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#1a2a20]">
            <span className="grid size-8 place-items-center rounded-lg bg-[#fdf3d7] text-[#a3762a]"><Tag aria-hidden="true" className="size-4" /></span>
            Calculate an offer
          </h2>

          <div>
            <label htmlFor="offer-customer" className={label}>Customer</label>
            <select id="offer-customer" value={customerId ?? ''} onChange={(e) => setCustomerId(Number(e.target.value))} className={field} disabled={!customers.length}>
              {!customers.length && <option value="">Loading customers…</option>}
              {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name} — {c.segment_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="offer-day" className={label}>Preferred day</label>
              <select id="offer-day" value={day} onChange={(e) => setDay(e.target.value)} className={field}>
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="offer-hour" className={label}>Preferred time</label>
              <select id="offer-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))} className={field}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-[#fdf8e8] px-3 py-2.5 text-[11px] leading-relaxed text-[#6b5a22]">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#8a6d12]" />
            When a discount is recommended, a real coupon is saved for {chosen?.full_name || 'this customer'}.
          </p>

          <button
            onClick={calculate}
            disabled={loading || !customerId}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] text-sm font-semibold text-[#ffffff] shadow-lg shadow-[#244a37]/25 transition-all hover:from-[#1b392b] hover:to-[#244a37] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {loading ? <RefreshCw aria-hidden="true" className="size-4 animate-spin" /> : <Sparkles aria-hidden="true" className="size-4" />}
            {loading ? 'Calculating…' : 'Calculate discount & create coupon'}
          </button>

          {error && (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700">
              <AlertCircle aria-hidden="true" className="size-4 shrink-0" /> {error}
            </p>
          )}
        </section>

        {/* RIGHT: result */}
        <section aria-live="polite">
          {!offer ? (
            <div className="grid min-h-[22rem] place-items-center rounded-2xl border border-dashed border-[#c3d3c9] bg-[#fafcfa] p-6 text-center">
              <div>
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#ffffff] text-[#a3b3a9] shadow-sm ring-1 ring-[#ebf0ec]">
                  <Ticket aria-hidden="true" className="size-6" />
                </span>
                <p className="mt-3 text-sm font-semibold text-[#33483c]">The offer will appear here</p>
                <p className="mt-1 text-xs text-[#8a9a92]">Pick a customer and a time slot, then calculate.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Ticket */}
              <div className="relative overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff] shadow-[0_24px_60px_-34px_rgba(36,74,55,0.45)]">
                <div className="grid sm:grid-cols-[11rem_minmax(0,1fr)]">
                  {/* stub */}
                  <div className={`relative flex flex-col items-center justify-center px-5 py-6 text-center ${hasDiscount ? 'bg-gradient-to-br from-[#1d3d2d] to-[#2f5d46]' : 'bg-[#6c7e73]'}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#f3d27a]">{hasDiscount ? 'Save' : 'No discount'}</p>
                    <p className="mt-1 text-5xl font-bold leading-none tracking-tight text-[#ffffff]">{Number(offer.calculated_discount_pct)}<span className="text-2xl">%</span></p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.3em] text-[#ffffff]/80">off</p>
                  </div>

                  {/* body */}
                  <div className="space-y-4 border-t-2 border-dashed border-[#dfe7e1] p-5 sm:border-l-2 sm:border-t-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a3762a]">{hasDiscount ? 'Personal offer' : 'Regular price'}</p>
                        <p className="mt-0.5 truncate text-lg font-bold text-[#1a2a20]">{offer.service_name}</p>
                        <p className="text-xs text-[#6c7e73]">For {chosen?.full_name}</p>
                      </div>
                      <div className="text-right">
                        {hasDiscount && original > 0 && (
                          <p className="text-sm tabular-nums text-[#a3b3a9] line-through">₹{original.toLocaleString('en-IN')}</p>
                        )}
                        <p className="text-3xl font-bold leading-tight tabular-nums text-[#244a37]">₹{Math.round(offer.final_price).toLocaleString('en-IN')}</p>
                        {hasDiscount && original > 0 && (
                          <span className="mt-1 inline-block rounded-full bg-[#e4eee7] px-2 py-0.5 text-[11px] font-semibold text-[#244a37]">
                            You save ₹{(original - Math.round(offer.final_price)).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                    </div>

                    {hasDiscount ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex-1 select-all rounded-xl border-2 border-dashed border-[#d9b860] bg-[#fdf8e8] px-4 py-2.5 text-center font-mono text-base font-bold tracking-[0.2em] text-[#5c430a]">
                          {offer.coupon_code}
                        </span>
                        <button onClick={copy}
                          className="flex h-11 items-center gap-1.5 rounded-xl bg-[#244a37] px-4 text-xs font-semibold text-[#ffffff] transition-colors hover:bg-[#1b392b] cursor-pointer">
                          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
                          {copied ? 'Copied!' : 'Copy code'}
                        </button>
                      </div>
                    ) : (
                      <p className="rounded-xl bg-[#f6faf7] px-4 py-3 text-xs text-[#4f6b5a]">No coupon was created, because this slot and customer do not need a discount.</p>
                    )}

                    {hasDiscount && (
                      <p className="flex items-center gap-1.5 text-xs text-[#6c7e73]">
                        <CalendarClock aria-hidden="true" className="size-3.5 text-[#a3762a]" />
                        Valid until <b className="text-[#1a2a20]">{validUntil}</b> · best on {day}, {hourLabel(hour)}
                      </p>
                    )}
                  </div>
                </div>

                {/* notches where the stub meets the body (desktop) */}
                <span aria-hidden="true" className="absolute left-[11rem] top-0 hidden size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffffff] ring-1 ring-[#dfe7e1] sm:block" />
                <span aria-hidden="true" className="absolute bottom-0 left-[11rem] hidden size-5 -translate-x-1/2 translate-y-1/2 rounded-full bg-[#ffffff] ring-1 ring-[#dfe7e1] sm:block" />
              </div>

              {/* Why */}
              <div className="space-y-3 rounded-2xl border border-[#dfe7e1] bg-[#fafcfa] p-5">
                <p className="text-xs font-bold text-[#1a2a20]">Why this offer</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { k: 'Customer segment', v: offer.customer_segment, tone: 'bg-[#e8f1f7] text-[#2f5f7f]' },
                    { k: 'Slot demand', v: offer.capacity_level, tone: 'bg-[#e3f3f1] text-[#23847a]' },
                    { k: 'Requested slot', v: `${day.slice(0, 3)}, ${hourLabel(hour)}`, tone: 'bg-[#f1f4f1] text-[#4f6b5a]' },
                  ].map(({ k, v, tone }) => (
                    <div key={k} className="rounded-xl bg-[#ffffff] p-3 ring-1 ring-[#ebf0ec]">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8a9a92]">{k}</p>
                      <span className={`mt-1.5 inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`} title={v}>{v}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-[#33483c]">{offer.explanation}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
