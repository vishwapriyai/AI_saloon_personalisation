import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Scissors, History, ArrowLeft, ChevronDown, LogOut, User, Users } from 'lucide-react';
import { clearSession, getSession, isStaff } from '../auth/session';
import { BRAND } from '../config/brand';
import { useIdleLogout } from '../auth/useIdleLogout';

const CUSTOMER_IDLE_MINUTES = 10;

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'U';

export const CustomerLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isHome = location.pathname === '/customer' || location.pathname === '/customer/login';
  // Highlighted tab in the header switcher; the profile page highlights neither
  const activeNav = location.pathname.startsWith('/customer/history') ? 'history'
    : isHome ? 'home'
    : location.pathname.startsWith('/customer/profile') ? null : 'look';
  const session = getSession();
  const staff = isStaff(session);
  const servingName = staff ? localStorage.getItem('salon_customer_name') : null;

  const logout = () => {
    clearSession();
    navigate(staff ? '/staff/login' : '/customer/login', { replace: true });
  };

  // A customer's own session on a shared tablet ends after a few idle minutes
  const idleLogout = useCallback(() => {
    clearSession();
    navigate('/customer/login', { replace: true });
  }, [navigate]);
  useIdleLogout(session?.kind === 'customer', CUSTOMER_IDLE_MINUTES, idleLogout);

  // Account menu (customers): closes on outside click or Escape
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
  const go = (to: string) => { setMenuOpen(false); navigate(to); };

  if (!session && isHome) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-[#ffffff] text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-900">
      {/* Header: centred brand, back on the left, account on the right */}
      <header className="sticky top-0 z-40 border-b border-[#ebf0ec] bg-[#ffffff]/90 backdrop-blur-md">
        <div className="mx-auto grid h-[4.5rem] w-full max-w-3xl lg:max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-6 lg:px-8">
          <div className="justify-self-start">
            {!isHome && (
              <button
                onClick={() => navigate(-1)}
                className="grid size-10 place-items-center rounded-full border border-[#dfe7e1] text-[#1a2a20] transition-colors hover:bg-[#eef3ee] active:scale-95 cursor-pointer"
                aria-label="Go Back"
              >
                <ArrowLeft className="size-5" />
              </button>
            )}
          </div>

          <button
            onClick={() => navigate('/customer/login')}
            className="flex flex-col items-center text-center cursor-pointer"
            aria-label={`${BRAND.name} home`}
          >
            <span className="flex items-center gap-2">
              <Scissors aria-hidden="true" className="size-4 text-[#2f5d46]" />
              <span className="text-lg font-bold tracking-tight text-[#1a2a20]">{BRAND.name}</span>
            </span>
            <span className="mt-0.5 hidden items-center gap-2 min-[420px]:flex">
              <span aria-hidden="true" className="h-px w-5 bg-[#c3d3c9]" />
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8a9a92]">{BRAND.tagline}</span>
              <span aria-hidden="true" className="h-px w-5 bg-[#c3d3c9]" />
            </span>
          </button>

          <div className="flex items-center gap-1.5 justify-self-end">
            {session && staff && (
              <>
                <button
                  onClick={() => navigate('/stylist/customers')}
                  className="flex h-10 items-center gap-2 rounded-full border border-[#dfe7e1] px-3.5 text-sm font-medium text-[#1a2a20] transition-colors hover:bg-[#f2f7f3] cursor-pointer"
                  title="Back to the customer directory"
                >
                  <Users className="size-4 text-[#2f5d46]" />
                  <span className="hidden sm:inline">{servingName ? `Serving: ${servingName}` : 'Customer Directory'}</span>
                </button>
                <button
                  onClick={logout}
                  className="grid size-10 place-items-center rounded-full text-[#6c7e73] transition-colors hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOut className="size-[18px]" />
                </button>
              </>
            )}

            {session && !staff && (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex h-10 items-center gap-2 rounded-full border border-[#dfe7e1] py-1 pl-1 pr-2.5 transition-colors hover:bg-[#eef3ee] cursor-pointer"
                >
                  <span className="grid size-8 place-items-center rounded-full bg-[#244a37] text-xs font-bold text-[#ffffff]">
                    {initials(session.name)}
                  </span>
                  <span className="hidden max-w-[6rem] truncate text-sm font-semibold text-[#1a2a20] md:inline">
                    {session.name.split(' ')[0]}
                  </span>
                  <ChevronDown aria-hidden="true" className={`size-4 text-[#6c7e73] transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      role="menu"
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.14 }}
                      className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 origin-top-right overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff] p-1.5 shadow-[0_20px_44px_-18px_rgba(36,74,55,0.5)]"
                    >
                      <div className="px-3 py-2.5">
                        <p className="truncate text-sm font-bold text-[#1a2a20]">{session.name}</p>
                        <p className="text-[11px] text-[#7f968a]">Signed in</p>
                      </div>
                      <div className="my-1 h-px bg-[#ebf0ec]" />
                      {([
                        { key: 'look', label: 'New Look', to: '/customer/photo', Icon: Scissors },
                        { key: 'history', label: 'My History', to: '/customer/history', Icon: History },
                        { key: null, label: 'My Profile', to: '/customer/profile', Icon: User },
                      ] as const).map(({ key, label, to, Icon }) => {
                        const active = key !== null ? key === activeNav : location.pathname.startsWith('/customer/profile');
                        return (
                          <button
                            key={label}
                            role="menuitem"
                            onClick={() => go(to)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                              active ? 'bg-[#e4eee7] text-[#1d3d2d]' : 'text-[#33483c] hover:bg-[#f2f7f3]'
                            }`}
                          >
                            <Icon aria-hidden="true" className="size-4 text-[#2f5d46]" />
                            {label}
                          </button>
                        );
                      })}
                      <div className="my-1 h-px bg-[#ebf0ec]" />
                      <button
                        role="menuitem"
                        onClick={logout}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 cursor-pointer"
                      >
                        <LogOut aria-hidden="true" className="size-4" />
                        Log out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl lg:max-w-5xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
};
