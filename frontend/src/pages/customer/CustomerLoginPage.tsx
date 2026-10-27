import React, { useEffect, useState, useId } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Toaster, toast } from 'sonner';
import {
  Phone, Lock, UserCheck, Sparkles, RefreshCw, Scissors, User,
  ShieldCheck, Eye, EyeOff, ArrowRight
} from 'lucide-react';
import {
  changeCustomerPassword, customerLogin, customerRegister,
  getCustomerHistory, getCustomerSummary, type CustomerHistory, type CustomerLoginResult
} from '../../api/client';
import { LatestLookCard, PreviousStylesStrip } from '../../components/CustomerFullProfile';
import { applyPreviousPhotoSession, continueTarget } from '../../utils/continueStyle';
import { clearCustomerContext, getSession, isStaff, saveSession } from '../../auth/session';
import { preparePreviousStyle } from '../../utils/previousStyle';
import { BRAND } from '../../config/brand';
import { workBranchId } from '../../utils/workBranch';

const MUST_CHANGE_KEY = 'salon_must_change_password';

// The salon theme remaps Tailwind's `white` to dark ink, so real white is spelled as hex here.
const fieldLabel = 'text-xs font-semibold tracking-wide text-[#33483c]';
const fieldIcon = 'pointer-events-none absolute left-4 size-4 text-[#7f968a] transition-colors group-focus-within:text-[#2f5d46]';
const fieldInput = 'h-11 w-full rounded-xl border border-[#c3d3c9] bg-[#ffffff] pl-11 text-sm font-medium text-[#1a2a20] placeholder-[#8b9a92] hover:border-[#9db5a6] focus:outline-none focus:border-[#2f5d46] focus:ring-4 focus:ring-[#2f5d46]/12 transition-all';
const primaryButton = 'h-11 w-full rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] hover:from-[#1b392b] hover:to-[#244a37] text-[#ffffff] font-semibold text-sm shadow-lg shadow-[#244a37]/25 hover:shadow-xl active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2 transition-all cursor-pointer';

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) score = Math.min(score, 1);
  const levels = [
    { label: 'Too short', color: '#d6cdbf' },
    { label: 'Weak', color: '#c2573a' },
    { label: 'Fair', color: '#d9a13b' },
    { label: 'Good', color: '#5a9a6e' },
    { label: 'Strong', color: '#2f5d46' },
  ];
  return { score, ...levels[score] };
}

/** Tilted "printed photo" used on the welcome hero; hides itself if the image cannot be loaded. */
const Polaroid: React.FC<{ src?: string | null; caption: string; tilt: string; className?: string }> = ({ src, caption, tilt, className = '' }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <figure className={`w-40 rounded-md bg-[#ffffff] p-2 pb-3 shadow-2xl shadow-black/40 transition-transform duration-300 hover:z-10 hover:rotate-0 hover:scale-105 ${tilt} ${className}`}>
      <img src={src} alt={caption} className="aspect-[4/5] w-full rounded-sm object-cover" onError={() => setBroken(true)} />
      <figcaption className="mt-2 text-center text-xs font-semibold italic text-[#33483c]">{caption}</figcaption>
    </figure>
  );
};

function readSummary(): any | null {
  try {
    return JSON.parse(localStorage.getItem('salon_customer_summary') || 'null');
  } catch {
    return null;
  }
}

export const CustomerLoginPage: React.FC = () => {
  const id = useId();
  const navigate = useNavigate();
  const session = getSession();

  // Mode: 'login' or 'register'
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [capsLock, setCapsLock] = useState(false);

  // Register form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Temporary password change state
  const [mustChange, setMustChange] = useState(() => localStorage.getItem(MUST_CHANGE_KEY) === '1');
  const [currentPassword, setCurrentPassword] = useState('');
  const [changedPassword, setChangedPassword] = useState('');
  const [changedConfirm, setChangedConfirm] = useState('');
  const [storedSummary, setSummary] = useState<any | null>(() => (session?.kind === 'customer' ? readSummary() : null));

  const loggedInCustomerId = session?.kind === 'customer' ? session.customerId ?? null : null;
  const summary = loggedInCustomerId ? storedSummary : null;
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const target = continueTarget(history, summary?.previous_style);

  useEffect(() => {
    if (!loggedInCustomerId || mustChange) return;
    let active = true;
    getCustomerSummary(loggedInCustomerId)
      .then((res) => {
        if (!active) return;
        setSummary(res.customer);
        localStorage.setItem('salon_customer_summary', JSON.stringify(res.customer));
      })
      .catch((err) => console.error('Could not refresh customer details:', err));
    getCustomerHistory(loggedInCustomerId)
      .then((h) => { if (active) setHistory(h); })
      .catch((err) => console.error('Could not load previous styles:', err));
    return () => { active = false; };
  }, [loggedInCustomerId, mustChange]);

  const startSession = (res: CustomerLoginResult) => {
    clearCustomerContext();
    saveSession({ kind: 'customer', token: res.access_token, role: res.role, name: res.customer.full_name, customerId: res.customer.id });
    localStorage.setItem('salon_customer_id', String(res.customer.id));
    localStorage.setItem('salon_customer_name', res.customer.full_name);
    localStorage.setItem('salon_customer_summary', JSON.stringify(res.customer));
    setSummary(res.customer);
    // Same URL, new location: makes CustomerLayout re-read the session (header, page width) without a refresh
    navigate('/customer/login', { replace: true });
    if (res.must_change_password) {
      localStorage.setItem(MUST_CHANGE_KEY, '1');
      setMustChange(true);
    } else {
      localStorage.removeItem(MUST_CHANGE_KEY);
      setMustChange(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changedPassword !== changedConfirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      startSession(await changeCustomerPassword(currentPassword || password, changedPassword));
      setPassword('');
      setCurrentPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      startSession(await customerLogin(identifier.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const referralCode = localStorage.getItem('salon_referral_code') || undefined;
      const res = await customerRegister({
        full_name: fullName,
        phone_number: phone,
        password: newPassword,
        gender,
        referral_code: referralCode,
        branch_id: workBranchId(),
      });
      localStorage.removeItem('salon_referral_code');
      startSession(res);
      navigate('/customer/photo');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Staff are signed in on this device: send them to their own area
  if (isStaff(session)) {
    return (
      <div className="flex-1 flex items-center justify-center py-6 px-4 min-h-screen bg-slate-900">
        <div className="w-full max-w-md bg-slate-800/80 border border-slate-700/60 rounded-2xl p-8 text-center space-y-4">
          <ShieldCheck className="w-10 h-10 text-amber-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">Signed in as salon staff ({session?.name})</h2>
          <p className="text-sm text-slate-400">Pick the customer you are serving from the customer directory.</p>
          <button onClick={() => navigate('/stylist/customers')} className="w-full min-h-[48px] rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold">
            Open Customer Directory
          </button>
        </div>
      </div>
    );
  }

  // Logged-in customer view
  if (summary) {
    const firstName = summary.full_name.split(' ')[0];
    const look = history?.latest_look;
    const aiShot = look?.images?.ai?.front;
    const resultShot = look?.images?.after?.front;
    const continueStyle = async () => {
      if (target.kind === 'style') {
        await preparePreviousStyle(target.style, summary.id);
        navigate('/customer/instructions');
      } else if (target.kind === 'photo') {
        applyPreviousPhotoSession(target.photo);
        navigate('/customer/service');
      }
    };
    return (
      <div className="auth-rise flex-1 py-2 sm:py-4">
        <div className="overflow-hidden rounded-[28px] border border-[#dfe7e1] bg-[#ffffff] shadow-[0_30px_70px_-36px_rgba(15,36,26,0.55)]">
          {/* HERO */}
          <section className="relative isolate overflow-hidden">
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: "url('/salon_hero.jpg')" }} />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0f241a] via-[#0f241a]/85 to-[#0f241a]/30" />
            <div aria-hidden="true" className="absolute -bottom-24 -left-16 -z-10 size-72 rounded-full bg-[#e9b949]/20 blur-3xl" />

            <div className="flex flex-col gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffffff]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a] ring-1 ring-[#ffffff]/15 backdrop-blur">
                  <Sparkles aria-hidden="true" className="size-3.5" /> Welcome back
                </span>
                <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-[#ffffff] sm:text-4xl">
                  Hi {firstName},<br />
                  <span className="text-[#f3d27a]">ready for a new look?</span>
                </h1>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    `${summary.total_visits} visits`,
                    summary.customer_type ? `${summary.customer_type} client` : summary.segment_name,
                    summary.customer_code,
                  ].filter(Boolean).map((chip) => (
                    <span key={String(chip)} className="rounded-full bg-[#ffffff]/10 px-3 py-1 text-xs font-medium text-[#ffffff]/90 ring-1 ring-[#ffffff]/15 backdrop-blur">{chip}</span>
                  ))}
                </div>

                {!mustChange && (
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <button
                      onClick={() => navigate('/customer/photo')}
                      className="group flex h-12 items-center justify-center gap-2 rounded-full bg-[#f3d27a] px-6 text-sm font-bold text-[#1d3d2d] shadow-lg shadow-black/25 transition-all hover:bg-[#f0c95f] hover:shadow-xl active:scale-[0.98] cursor-pointer"
                    >
                      <Sparkles aria-hidden="true" className="size-4" /> Generate new style
                      <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                    <button
                      onClick={continueStyle}
                      disabled={target.kind === 'none'}
                      title={target.hint}
                      className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#ffffff]/10 px-6 text-sm font-semibold text-[#ffffff] ring-1 ring-[#ffffff]/25 backdrop-blur transition-all hover:bg-[#ffffff]/20 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      <UserCheck aria-hidden="true" className="size-4 text-[#f3d27a]" /> Continue previous style
                    </button>
                  </div>
                )}
                {!mustChange && target.kind !== 'none' && (
                  <p className="mt-2.5 text-xs text-[#ffffff]/60">{target.hint}</p>
                )}
              </div>

              {/* Latest look as two printed photos */}
              {(aiShot || resultShot) && (
                <div className="relative hidden h-56 w-80 shrink-0 lg:block" aria-label="Your latest look">
                  <Polaroid src={aiShot} caption="AI preview" tilt="-rotate-6" className="absolute left-0 top-2" />
                  <Polaroid src={resultShot} caption={look?.style_name || 'Your result'} tilt="rotate-6" className="absolute right-0 top-0" />
                </div>
              )}
            </div>
          </section>

          {/* BODY */}
          <div className="space-y-6 bg-[#f7f9f7] p-4 sm:p-6">
            {mustChange ? (
              <form onSubmit={handleChangePassword} className="mx-auto max-w-md space-y-4 rounded-2xl bg-[#ffffff] p-5 ring-1 ring-[#dfe7e1]">
                <p className="text-sm text-[#4f6b5a]">Please choose your own password. The one you used was a one-time password from the salon.</p>
                {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-xs font-medium text-rose-700">{error}</div>}
                {!password && (
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="One-time password" autoComplete="current-password" className={`${fieldInput} px-4`} required />
                )}
                <input type="password" value={changedPassword} onChange={(e) => setChangedPassword(e.target.value)}
                  placeholder="New password (min. 8, letters and numbers)" autoComplete="new-password" minLength={8} className={`${fieldInput} px-4`} required />
                <input type="password" value={changedConfirm} onChange={(e) => setChangedConfirm(e.target.value)}
                  placeholder="Confirm new password" autoComplete="new-password" minLength={8} className={`${fieldInput} px-4`} required />
                <button type="submit" disabled={loading} className={primaryButton}>
                  {loading ? <RefreshCw className="size-4 animate-spin" /> : <><span>Save password &amp; continue</span><ArrowRight className="size-4" /></>}
                </button>
              </form>
            ) : (
              <>
                <LatestLookCard history={history} />

                {history && (
                  <section className="space-y-3 rounded-2xl bg-[#ffffff] p-4 ring-1 ring-[#dfe7e1] sm:p-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[#1a2a20]">Your style collection</h3>
                      <button onClick={() => navigate('/customer/history')} className="flex items-center gap-1 text-xs font-semibold text-[#2f5d46] hover:underline underline-offset-4 cursor-pointer">
                        See all <ArrowRight aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                    <PreviousStylesStrip
                      history={history}
                      limit={4}
                      onRepeat={async (style) => {
                        await preparePreviousStyle(style, summary.id);
                        navigate('/customer/instructions');
                      }}
                    />
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Modern Two-Column Split Layout (Hero Card on Left, Auth Form on Right)
  return (
    <>
    <Toaster position="top-center" richColors closeButton />
    <main
      aria-label="Sign in"
      className="min-h-screen w-full grid place-items-center bg-[#f5f1ea] text-[#2a2520] font-sans p-4 sm:p-6"
      style={{ fontFamily: "'Poppins', sans-serif" }}
    >
      <MotionConfig reducedMotion="user">
      {/* OVERALL CONTAINER: compact card holding hero (left) and auth form (right) */}
      <div className="auth-rise grid w-full max-w-[1040px] lg:grid-cols-[0.9fr_1.1fr] overflow-hidden rounded-[28px] border border-[#e8e0d3] bg-[#ffffff] shadow-[0_30px_70px_-35px_rgba(36,74,55,0.45)]">
        {/* LEFT SECTION (ON DESKTOP): SALON HERO */}
        <aside className="relative hidden lg:flex min-h-[620px] flex-col justify-end overflow-hidden p-10" style={{ color: '#ffffff' }}>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url('/salon_hero.jpg')` }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#09150f]/85 via-[#09150f]/10 to-transparent" />

          {/* Headline */}
          <h2 className="relative z-10 max-w-[18rem] text-2xl font-bold leading-snug tracking-tight text-[#ffffff] drop-shadow-md">
            See your new look{' '}
            <span className="text-[#f3d27a]">before the first cut.</span>
          </h2>
        </aside>

        {/* RIGHT SECTION (ON DESKTOP): AUTH FORM */}
        <section className="relative flex flex-col justify-center p-6 sm:p-9 lg:px-14 lg:py-12">
        <div className="relative mx-auto flex w-full max-w-[26rem] flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-full bg-[#ffffff] ring-2 ring-[#2f5d46]/20 shadow-sm">
                <Scissors aria-hidden="true" className="size-4 text-[#2f5d46]" />
              </span>
              <span className="text-sm font-semibold text-[#1a2a20]">{BRAND.name}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#1a2a20]">
              {mode === 'login' ? 'Welcome back' : 'Create an account'}
            </h1>
            <p className="text-sm text-[#6c7e73]">
              {mode === 'login'
                ? 'Sign in to continue your style journey.'
                : `Join ${BRAND.name} for AI-powered hairstyle transformations.`}
            </p>
          </div>

          {/* Form Card */}
          <div className="relative">

            {/* Sign in / Join tabs */}
            <div role="tablist" aria-label="Account" className="relative mb-5 grid grid-cols-2 rounded-xl bg-[#e4eee7] p-1">
              {([['login', 'Sign in'], ['register', 'Join now']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); }}
                  className="relative z-10 h-9 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
                  style={{ color: mode === m ? '#1a2a20' : '#4f6b5a' }}
                >
                  {mode === m && (
                    <motion.span
                      layoutId="auth-tab"
                      className="absolute inset-0 -z-10 rounded-lg bg-[#ffffff] shadow-sm ring-1 ring-[#2a2520]/5"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  {label}
                </button>
              ))}
            </div>

            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  key={error}
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto', x: [0, -6, 6, -4, 4, 0] }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35 }}
                  className="mb-5 overflow-hidden"
                >
                  <div className="p-3 text-xs font-medium rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-center">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
            {/* SIGN IN FORM */}
            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {/* Field 1: Identifier */}
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${id}-identifier`} className={fieldLabel}>
                    Mobile Number / Customer ID
                  </label>
                  <div className="group relative flex items-center">
                    <Phone aria-hidden="true" className={fieldIcon} />
                    <input
                      id={`${id}-identifier`}
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. 9876500002 or CUST-1001"
                      autoComplete="username"
                      required
                      className={`${fieldInput} pr-4`}
                    />
                  </div>
                </div>

                {/* Field 2: Password */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${id}-password`} className={fieldLabel}>
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => toast.info('Forgot your password?', { description: 'Please ask salon staff for a one-time OTP.' })}
                      className="text-xs font-semibold text-[#2f5d46] hover:text-[#1d3d2d] hover:underline underline-offset-4 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="group relative flex items-center">
                    <Lock aria-hidden="true" className={fieldIcon} />
                    <input
                      id={`${id}-password`}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                      onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                      onBlur={() => setCapsLock(false)}
                      className={`${fieldInput} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((show) => !show)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 grid size-8 place-items-center rounded-lg text-[#7f968a] hover:bg-[#2f5d46]/8 hover:text-[#2f5d46] transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {capsLock && (
                    <p role="status" className="text-[11px] font-medium text-[#a3602c]">Caps Lock is on</p>
                  )}
                </div>

                {/* Remember Me Checkbox */}
                <label
                  htmlFor={`${id}-remember`}
                  className="flex items-center gap-2.5 text-xs font-medium text-[#4f5f54] cursor-pointer select-none w-fit"
                >
                  <input
                    id={`${id}-remember`}
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="size-4 rounded cursor-pointer accent-[#2f5d46]"
                  />
                  Keep me logged in
                </label>

                {/* Submit Button */}
                <button type="submit" disabled={loading} className={`group ${primaryButton}`}>
                  {loading ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      <span>Signing in…</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in</span>
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>

                {/* Forgot password hint */}
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#6c7e73] leading-relaxed">
                  <ShieldCheck aria-hidden="true" className="size-3.5 text-[#2f5d46]" />
                  Forgot password? Ask salon staff for a one-time OTP.
                </p>
              </form>
            ) : (
              /* NEW CUSTOMER REGISTRATION FORM */
              <form onSubmit={handleRegister} className="flex flex-col gap-3">
                {/* Field 1: Full name */}
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-fullname`} className={fieldLabel}>Full Name</label>
                  <div className="group relative flex items-center">
                    <User aria-hidden="true" className={fieldIcon} />
                    <input
                      id={`${id}-fullname`}
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Full name"
                      autoComplete="name"
                      required
                      className={`${fieldInput} h-10! pr-4`}
                    />
                  </div>
                </div>

                {/* Field 2: Mobile Number */}
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-phone`} className={fieldLabel}>Mobile Number</label>
                  <div className="group relative flex items-center">
                    <Phone aria-hidden="true" className={fieldIcon} />
                    <input
                      id={`${id}-phone`}
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="10-digit mobile number"
                      autoComplete="tel"
                      required
                      className={`${fieldInput} h-10! pr-4`}
                    />
                  </div>
                </div>

                {/* Field 3: Password */}
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-new-password`} className={fieldLabel}>Password</label>
                  <div className="group relative flex items-center">
                    <Lock aria-hidden="true" className={fieldIcon} />
                    <input
                      id={`${id}-new-password`}
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Choose a password (min. 8 chars)"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      className={`${fieldInput} h-10! pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 grid size-8 place-items-center rounded-lg text-[#7f968a] hover:bg-[#2f5d46]/8 hover:text-[#2f5d46] transition-colors cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {newPassword && (() => {
                    const s = passwordStrength(newPassword);
                    return (
                      <div className="flex items-center gap-2" aria-live="polite">
                        <div className="grid flex-1 grid-cols-4 gap-1">
                          {[1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className="h-1 rounded-full transition-colors duration-300"
                              style={{ backgroundColor: i <= s.score ? s.color : '#ece5d9' }}
                            />
                          ))}
                        </div>
                        <span className="w-14 text-right text-[11px] font-semibold" style={{ color: s.color }}>{s.label}</span>
                      </div>
                    );
                  })()}
                </div>

                {/* Field 4: Confirm Password */}
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-confirm-password`} className={fieldLabel}>Confirm Password</label>
                  <div className="group relative flex items-center">
                    <Lock aria-hidden="true" className={fieldIcon} />
                    <input
                      id={`${id}-confirm-password`}
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      className={`${fieldInput} h-10! pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 grid size-8 place-items-center rounded-lg text-[#7f968a] hover:bg-[#2f5d46]/8 hover:text-[#2f5d46] transition-colors cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* Field 5: Salon Category */}
                <div className="grid grid-cols-2 gap-2.5">
                  {([['Male', "Men's Salon"], ['Female', "Women's Salon"]] as const).map(([g, label]) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      aria-pressed={gender === g}
                      className={`h-10 px-3 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${
                        gender === g
                          ? 'bg-[#244a37] text-[#ffffff] border-[#244a37] shadow-md shadow-[#244a37]/20'
                          : 'bg-[#ffffff] border-[#c3d3c9] text-[#4f5f54] hover:border-[#2f5d46]/50 hover:bg-[#2f5d46]/5'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Submit Button */}
                <button type="submit" disabled={loading} className={`mt-1 h-10! ${primaryButton}`}>
                  {loading ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      <span>Creating account…</span>
                    </>
                  ) : 'Register & Take Photo'}
                </button>
              </form>
            )}
            </motion.div>
            </AnimatePresence>
          </div>

          {/* Staff Login Link */}
          {mode === 'login' && (
            <p className="text-center text-xs text-[#6c7e73]">
              Salon staff?{' '}
              <Link to="/staff/login" className="font-bold text-[#2f5d46] hover:underline underline-offset-4">
                Stylist / Admin login
              </Link>
            </p>
          )}
        </div>
        </section>
      </div>
      </MotionConfig>
    </main>
    </>
  );
};
export default CustomerLoginPage;
