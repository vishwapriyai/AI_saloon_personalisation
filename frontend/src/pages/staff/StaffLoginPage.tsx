import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { User, Lock, ArrowRight, RefreshCw, ShieldCheck, Eye, EyeOff, Scissors, LayoutDashboard } from 'lucide-react';
import { salonLogin } from '../../api/client';
import { clearCustomerContext, getSession, isAdmin, isStaff, saveSession } from '../../auth/session';
import { BRAND } from '../../config/brand';

// The salon theme remaps Tailwind's `white` to dark ink, so real white is spelled as hex here.
const fieldLabel = 'text-xs font-semibold tracking-wide text-[#33483c]';
const fieldIcon = 'pointer-events-none absolute left-4 size-4 text-[#7f968a] transition-colors group-focus-within:text-[#2f5d46]';
const fieldInput = 'h-11 w-full rounded-xl border border-[#c3d3c9] bg-[#ffffff] pl-11 text-sm font-medium text-[#1a2a20] placeholder-[#8b9a92] hover:border-[#9db5a6] focus:outline-none focus:border-[#2f5d46] focus:ring-4 focus:ring-[#2f5d46]/12 transition-all';
const primaryButton = 'h-11 w-full rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] hover:from-[#1b392b] hover:to-[#244a37] text-[#ffffff] font-semibold text-sm shadow-lg shadow-[#244a37]/25 hover:shadow-xl active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2 transition-all cursor-pointer';

const ROLES = [
  { key: 'stylist', label: 'Stylist', Icon: Scissors, hint: 'Serve customers, show looks and confirm services.', demo: { u: 'stylist', p: 'Stylist@123' } },
  { key: 'admin', label: 'Admin', Icon: LayoutDashboard, hint: 'Dashboard, customers, campaigns and capacity.', demo: { u: 'admin', p: 'Admin@123' } },
] as const;
type RoleKey = typeof ROLES[number]['key'];

/** Separate login for salon staff: stylists go to the customer directory, admins to the dashboard. */
export const StaffLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState<RoleKey>('stylist');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = getSession();
  const roleInfo = ROLES.find((r) => r.key === role)!;

  const goHome = () => navigate(isAdmin(getSession()) ? '/admin/dashboard' : '/stylist/customers', { replace: true });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await salonLogin(username.trim(), password);
      clearCustomerContext();
      saveSession({ kind: 'staff', token: res.access_token, role: res.role, name: res.full_name, userId: res.user_id });
      goHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your username and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      aria-label="Staff sign in"
      className="grid min-h-screen w-full place-items-center bg-[#f5f1ea] p-4 font-sans text-[#2a2520] sm:p-6"
      style={{ fontFamily: "'Poppins', sans-serif" }}
    >
      <div className="auth-rise grid w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-[#dfe7e1] bg-[#ffffff] shadow-[0_30px_70px_-35px_rgba(36,74,55,0.45)] lg:grid-cols-[0.9fr_1.1fr]">
        {/* LEFT: salon photo */}
        <aside className="relative hidden min-h-[620px] flex-col justify-end overflow-hidden p-10 lg:flex">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/salon_hero.jpg')" }} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#09150f]/90 via-[#09150f]/20 to-transparent" />
          <div className="relative space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffffff]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a] ring-1 ring-[#ffffff]/20 backdrop-blur">
              <ShieldCheck aria-hidden="true" className="size-3.5" /> Salon team
            </span>
            <h2 className="max-w-[20rem] text-2xl font-bold leading-snug tracking-tight text-[#ffffff] drop-shadow-md">
              Every client and every look,{' '}
              <span className="text-[#f3d27a]">in one place.</span>
            </h2>
          </div>
        </aside>

        {/* RIGHT: sign in */}
        <section className="flex flex-col justify-center p-6 sm:p-9 lg:px-14 lg:py-12">
          <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-6">
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => navigate('/customer/login')} className="mb-3 flex w-fit items-center gap-2.5 cursor-pointer">
                <span className="grid size-9 place-items-center rounded-full bg-[#ffffff] shadow-sm ring-2 ring-[#2f5d46]/20">
                  <Scissors aria-hidden="true" className="size-4 text-[#2f5d46]" />
                </span>
                <span className="text-sm font-semibold text-[#1a2a20]">{BRAND.name}</span>
              </button>
              <h1 className="text-2xl font-bold tracking-tight text-[#1a2a20]">Staff sign in</h1>
              <p className="text-sm text-[#6c7e73]">For stylists and salon admins.</p>
            </div>

            {isStaff(existing) ? (
              <div className="space-y-4 rounded-2xl border border-[#dfe7e1] bg-[#fafcfa] p-5 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#244a37] text-lg font-bold text-[#f3d27a]">
                  {existing?.name?.[0] || '?'}
                </span>
                <p className="text-sm text-[#4f6b5a]">
                  You are signed in as <span className="font-bold text-[#1a2a20]">{existing?.name}</span>
                  <span className="mt-1 block text-xs text-[#7f968a]">{existing?.role}</span>
                </p>
                <button onClick={goHome} className={primaryButton}>Continue <ArrowRight aria-hidden="true" className="size-4" /></button>
              </div>
            ) : (
              <>
                {/* Stylist / Admin */}
                <div>
                  <div role="tablist" aria-label="I am a" className="grid grid-cols-2 rounded-xl bg-[#e4eee7] p-1">
                    {ROLES.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={role === key}
                        onClick={() => { setRole(key); setError(null); }}
                        className="relative z-10 flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
                        style={{ color: role === key ? '#1a2a20' : '#4f6b5a' }}
                      >
                        {role === key && (
                          <motion.span
                            layoutId="staff-role-tab"
                            className="absolute inset-0 -z-10 rounded-lg bg-[#ffffff] shadow-sm ring-1 ring-[#2a2520]/5"
                            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                          />
                        )}
                        <Icon aria-hidden="true" className="size-4" /> {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-[#7f968a]">{roleInfo.hint}</p>
                </div>

                {error && (
                  <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-xs font-medium text-rose-700">{error}</div>
                )}

                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="staff-username" className={fieldLabel}>Username</label>
                    <div className="group relative flex items-center">
                      <User aria-hidden="true" className={fieldIcon} />
                      <input id="staff-username" value={username} onChange={(e) => setUsername(e.target.value)}
                        placeholder={`e.g. ${roleInfo.demo.u}`} autoComplete="username" className={`${fieldInput} pr-4`} required />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="staff-password" className={fieldLabel}>Password</label>
                    <div className="group relative flex items-center">
                      <Lock aria-hidden="true" className={fieldIcon} />
                      <input id="staff-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password" autoComplete="current-password" className={`${fieldInput} pr-11`} required />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 grid size-8 place-items-center rounded-lg text-[#7f968a] transition-colors hover:bg-[#2f5d46]/10 hover:text-[#2f5d46] cursor-pointer">
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" disabled={loading} className={`group ${primaryButton}`}>
                    {loading ? (
                      <><RefreshCw className="size-4 animate-spin" /><span>Signing in…</span></>
                    ) : (
                      <><span>Sign in as {roleInfo.label.toLowerCase()}</span><ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>
                    )}
                  </button>
                </form>

                {/* Demo accounts: tap to fill */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#f6faf7] px-3 py-2.5">
                  <span className="text-[11px] font-semibold text-[#6c7e73]">Demo:</span>
                  {ROLES.map(({ key, label, demo }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setRole(key); setUsername(demo.u); setPassword(demo.p); setError(null); }}
                      className="rounded-full bg-[#ffffff] px-2.5 py-1 font-mono text-[11px] text-[#2f5d46] ring-1 ring-[#dfe7e1] transition-colors hover:ring-[#2f5d46]/40 cursor-pointer"
                      title={`Fill the ${label.toLowerCase()} demo account`}
                    >
                      {demo.u} / {demo.p}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="text-center text-xs text-[#6c7e73]">
              Customer?{' '}
              <Link to="/customer/login" className="font-bold text-[#2f5d46] hover:underline underline-offset-4">Customer login</Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
};
