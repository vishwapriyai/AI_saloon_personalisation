import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, RefreshCw, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { salonLogin } from '../../api/client';
import { clearCustomerContext, getSession, isAdmin, isStaff, saveSession } from '../../auth/session';
import {
  authCard, authContainer, authError, authEyeButton, authFieldIcon, authFooterLink, authHint, authIconBadge,
  authInput, authLabel, authPasswordInput, authPrimaryButton, authSubtitle, authTitle,
} from '../../auth/authStyles';
import { BrandLogo } from '../../components/BrandLogo';

/** Separate login for salon staff: stylists go to the customer directory, admins to the dashboard. */
export const StaffLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = getSession();

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

  // Same page frame and card as the customer login (CustomerLayout + CustomerLoginPage)
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-900">
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <BrandLogo onClick={() => navigate('/customer/login')} />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center py-6 px-4">
          <div className={authContainer}>
            <div className={authCard}>
              <div className="text-center mb-8">
                <div className={authIconBadge}>
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h2 className={authTitle}>Salon Staff Login</h2>
                <p className={authSubtitle}>For stylists and salon admins</p>
              </div>

              {isStaff(existing) ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-slate-300">You are signed in as <span className="font-bold text-white">{existing?.name}</span> ({existing?.role}).</p>
                  <button onClick={goHome} className={authPrimaryButton}>Continue</button>
                </div>
              ) : (
                <>
                  {error && <div role="alert" className={authError}>{error}</div>}
                  <form onSubmit={handleLogin} className="space-y-5">
                    <div>
                      <label className={authLabel}>Username</label>
                      <div className="relative">
                        <User className={authFieldIcon} />
                        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. stylist or admin"
                          autoComplete="username" className={authInput} required />
                      </div>
                    </div>
                    <div>
                      <label className={authLabel}>Password</label>
                      <div className="relative">
                        <Lock className={authFieldIcon} />
                        <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••" autoComplete="current-password" className={authPasswordInput} required />
                        <button type="button" onClick={() => setShowPassword((v) => !v)} className={authEyeButton}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}>
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    <button type="submit" disabled={loading} className={authPrimaryButton}>
                      {loading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <><span>Log In</span><ArrowRight className="w-5 h-5" /></>}
                    </button>
                    <p className={authHint}>
                      Demo accounts: <span className="font-mono text-slate-400">stylist / Stylist@123</span> · <span className="font-mono text-slate-400">admin / Admin@123</span>
                    </p>
                  </form>
                </>
              )}
            </div>
            <p className={authFooterLink}>
              Customer? <Link to="/customer/login" className="text-amber-400 hover:text-amber-300 font-semibold">Customer login</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};
