import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Scissors, User, History, Home, ArrowLeft, LogOut, Users } from 'lucide-react';
import { clearSession, getSession, isStaff } from '../auth/session';
import { BrandLogo } from '../components/BrandLogo';

export const CustomerLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isHome = location.pathname === '/customer' || location.pathname === '/customer/login';
  const session = getSession();
  const staff = isStaff(session);
  const servingName = staff ? localStorage.getItem('salon_customer_name') : null;

  const logout = () => {
    clearSession();
    navigate(staff ? '/staff/login' : '/customer/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-900">
      {/* Header Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {!isHome && (
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all text-slate-300 touch-target-large flex items-center justify-center"
              aria-label="Go Back"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
          )}
          <BrandLogo onClick={() => navigate('/customer/login')} />
        </div>

        {/* Right side: account actions, with Logout last (top-right corner) */}
        {session && (
          <div className="flex items-center space-x-2">
            {staff ? (
              <button
                onClick={() => navigate('/stylist/customers')}
                className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-sm font-medium flex items-center space-x-2 border border-slate-700/50 touch-target-large"
                title="Back to the customer directory"
              >
                <Users className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">{servingName ? `Serving: ${servingName}` : 'Customer Directory'}</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => navigate('/customer/history')}
                  className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-sm font-medium flex items-center space-x-2 border border-slate-700/50 touch-target-large"
                >
                  <History className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">My History</span>
                </button>
                <button
                  onClick={() => navigate('/customer/profile')}
                  className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/50 touch-target-large flex items-center justify-center"
                  aria-label="My profile"
                >
                  <User className="w-5 h-5 text-amber-400" />
                </button>
              </>
            )}
            <button
              onClick={logout}
              className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-rose-500/15 text-slate-200 hover:text-rose-300 text-sm font-medium flex items-center space-x-2 border border-slate-700/50 hover:border-rose-500/40 touch-target-large"
              aria-label="Log out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl lg:max-w-5xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        <Outlet />
      </main>

      {/* Bottom Touch-friendly Navigation Bar for Mobile/Tablet */}
      {session && !staff && <nav className="sticky bottom-0 z-30 bg-slate-900/95 border-t border-slate-800 px-4 py-2 sm:hidden flex items-center justify-around">
        <button
          onClick={() => navigate('/customer/login')}
          className={`flex flex-col items-center py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
            location.pathname === '/customer/login' ? 'text-amber-400' : 'text-slate-400'
          }`}
        >
          <Home className="w-5 h-5 mb-1" />
          Home
        </button>
        <button
          onClick={() => navigate('/customer/photo')}
          className={`flex flex-col items-center py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
            location.pathname === '/customer/photo' ? 'text-amber-400' : 'text-slate-400'
          }`}
        >
          <Scissors className="w-5 h-5 mb-1" />
          New Look
        </button>
        <button
          onClick={() => navigate('/customer/history')}
          className={`flex flex-col items-center py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
            location.pathname === '/customer/history' ? 'text-amber-400' : 'text-slate-400'
          }`}
        >
          <History className="w-5 h-5 mb-1" />
          History
        </button>
      </nav>}
    </div>
  );
};
