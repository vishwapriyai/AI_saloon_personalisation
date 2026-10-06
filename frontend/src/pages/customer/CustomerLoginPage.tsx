import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Phone, Lock, ArrowRight, UserCheck, Sparkles, RefreshCw, Scissors, User, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { customerLogin, customerRegister, getCustomerSummary, type CustomerLoginResult } from '../../api/client';
import { clearCustomerContext, getSession, isStaff, saveSession } from '../../auth/session';
import { preparePreviousStyle } from '../../utils/previousStyle';
import {
  authCard, authContainer, authError, authEyeButton, authFooterLink, authHint, authIconBadge, authInput,
  authLabel, authPasswordInput, authPrimaryButton, authSubtitle, authTitle,
} from '../../auth/authStyles';

const inputClass = authInput;
const passwordInputClass = authPasswordInput;

function readSummary(): any | null {
  try {
    return JSON.parse(localStorage.getItem('salon_customer_summary') || 'null');
  } catch {
    return null;
  }
}

export const CustomerLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const session = getSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedSummary, setSummary] = useState<any | null>(() => (session?.kind === 'customer' ? readSummary() : null));
  // Shown only while a customer is logged in: after Logout this page must show the login form again
  const loggedInCustomerId = session?.kind === 'customer' ? session.customerId ?? null : null;
  const summary = loggedInCustomerId ? storedSummary : null;

  // Always refresh from the server so the latest chosen style shows (not the copy saved at login)
  useEffect(() => {
    if (!loggedInCustomerId) return;
    let active = true;
    getCustomerSummary(loggedInCustomerId)
      .then((res) => {
        if (!active) return;
        setSummary(res.customer);
        localStorage.setItem('salon_customer_summary', JSON.stringify(res.customer));
      })
      .catch((err) => console.error('Could not refresh customer details:', err));
    return () => { active = false; };
  }, [loggedInCustomerId]);

  const startSession = (res: CustomerLoginResult) => {
    clearCustomerContext();
    saveSession({ kind: 'customer', token: res.access_token, role: res.role, name: res.customer.full_name, customerId: res.customer.id });
    localStorage.setItem('salon_customer_id', String(res.customer.id));
    localStorage.setItem('salon_customer_name', res.customer.full_name);
    localStorage.setItem('salon_customer_summary', JSON.stringify(res.customer));
    setSummary(res.customer);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      startSession(await customerLogin(identifier.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
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
      const res = await customerRegister({ full_name: fullName, phone_number: phone, password: newPassword, gender, referral_code: referralCode });
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
      <div className="flex-1 flex items-center justify-center py-6 px-4">
        <div className="w-full bg-slate-800/80 border border-slate-700/60 rounded-3xl p-8 text-center space-y-4">
          <ShieldCheck className="w-10 h-10 text-amber-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">Signed in as salon staff ({session?.name})</h2>
          <p className="text-sm text-slate-400">Pick the customer you are serving from the customer directory.</p>
          <button onClick={() => navigate('/stylist/customers')} className="w-full min-h-[48px] rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold">
            Open Customer Directory
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-6 px-4">
      <div className={authContainer}>
        <div className={authCard}>
          <div className="text-center mb-8">
            <div className={authIconBadge}>
              <Scissors className="w-8 h-8" />
            </div>
            <h2 className={authTitle}>
              {summary ? `Welcome back, ${summary.full_name.split(' ')[0]}` : 'Welcome to Salon AI'}
            </h2>
            <p className={authSubtitle}>
              {summary ? 'Continue your last look or create a new one' : 'Log in to start your personalized style session'}
            </p>
          </div>

          {summary ? (
            /* LOGGED-IN CUSTOMER: previous style and next step */
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xl">
                  {summary.full_name[0]}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">{summary.full_name}</h3>
                  <p className="text-xs text-amber-400 font-semibold">
                    {summary.customer_code} • {summary.segment_name} • {summary.total_visits} Visits
                  </p>
                </div>
              </div>

              {summary.previous_style?.reference_image_url && (
                <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/50">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your Previous Hairstyle</p>
                  <div className="relative mx-auto h-72 sm:h-80 aspect-[4/5] max-w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/60">
                    <img src={summary.previous_style.reference_image_url} alt="Previous Style" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent flex items-end p-3">
                      <span className="text-xs font-bold text-amber-300">{summary.previous_style?.hairstyle_name || 'Previous Selected Hairstyle'}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {summary.previous_style?.reference_image_url && (
                  <button
                    onClick={async () => { await preparePreviousStyle(summary.previous_style); navigate('/customer/instructions'); }}
                    className="p-4 rounded-2xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold text-center flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 transition-all"
                  >
                    <UserCheck className="w-6 h-6 text-amber-400" />
                    <span>Continue Previous Style</span>
                  </button>
                )}
                <button
                  onClick={() => navigate('/customer/photo')}
                  className={`p-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-center flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 transition-all shadow-lg shadow-amber-500/20 ${summary.previous_style?.reference_image_url ? '' : 'sm:col-span-2'}`}
                >
                  <Sparkles className="w-6 h-6 text-slate-950" />
                  <span>Generate New Style</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Log in / New customer switch */}
              <div className="bg-slate-900/80 p-1 rounded-2xl border border-slate-700/80 mb-6 grid grid-cols-2 gap-1">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setError(null); }}
                    className={`min-h-[44px] rounded-xl font-bold text-sm transition-all ${mode === m ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  >
                    {m === 'login' ? 'Log In' : 'New Customer'}
                  </button>
                ))}
              </div>

              {error && (
                <div role="alert" className={authError}>
                  {error}
                </div>
              )}

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <div>
                    <label className={authLabel}>Mobile Number / Customer ID</label>
                    <div className="relative">
                      <Phone className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. 9876500002 or CUST-1001"
                        autoComplete="username" className={inputClass} required />
                    </div>
                  </div>
                  <div>
                    <label className={authLabel}>Password</label>
                    <div className="relative">
                      <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                        autoComplete="current-password" className={passwordInputClass} required />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        className={authEyeButton}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={loading}
                    className={authPrimaryButton}>
                    {loading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <><span>Log In</span><ArrowRight className="w-5 h-5" /></>}
                  </button>
                  <p className={authHint}>Demo: existing customers use the sample password <span className="font-mono text-slate-400">Customer@123</span></p>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="relative">
                    <User className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" autoComplete="name" className={inputClass} required />
                  </div>
                  <div className="relative">
                    <Phone className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" autoComplete="tel" className={inputClass} required />
                  </div>
                  <div className="relative">
                    <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Choose a password (min. 6 characters)"
                      autoComplete="new-password" minLength={6} className={passwordInputClass} required />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        className={authEyeButton}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password"
                      autoComplete="new-password" minLength={6} className={passwordInputClass} required />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        className={authEyeButton}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {([['Male', "Men's Salon"], ['Female', "Women's Salon"]] as const).map(([g, label]) => (
                      <button key={g} type="button" onClick={() => setGender(g)}
                        className={`p-3.5 rounded-2xl border font-bold text-sm touch-target-large transition-all ${gender === g ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-4 rounded-2xl text-base shadow-lg active:scale-95 transition-all touch-target-large disabled:opacity-60">
                    {loading ? 'Creating your profile...' : 'Register & Take Photo'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {!summary && (
          <p className={authFooterLink}>
            Salon staff? <Link to="/staff/login" className="text-amber-400 hover:text-amber-300 font-semibold">Stylist / Admin login</Link>
          </p>
        )}
      </div>
    </div>
  );
};
