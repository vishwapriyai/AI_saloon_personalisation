import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Scissors, LogOut, LayoutDashboard } from 'lucide-react';
import { clearSession, getSession, isAdmin } from '../auth/session';

export const StylistLayout: React.FC = () => {
  const navigate = useNavigate();
  const session = getSession();

  const logout = () => {
    clearSession();
    navigate('/staff/login', { replace: true });
  };

  const tab = ({ isActive }: { isActive: boolean }) =>
    `px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors ${isActive ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <Scissors className="w-6 h-6 text-amber-400" />
            <h1 className="font-bold text-white tracking-wide hidden sm:block">STYLIST WORKSTATION</h1>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/stylist/customers" className={tab}>Customers</NavLink>
            <NavLink to="/stylist/appointments" className={tab}>Appointments</NavLink>
          </nav>
        </div>

        {/* Signed-in staff member and Logout, top-right */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin(session) && (
            <button onClick={() => navigate('/admin/dashboard')} className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300" aria-label="Admin dashboard" title="Admin dashboard">
              <LayoutDashboard className="w-4 h-4" />
            </button>
          )}
          <div className="hidden md:block text-right leading-tight">
            <p className="text-sm font-semibold text-white">{session?.name}</p>
            <p className="text-[11px] text-slate-400">{session?.role}</p>
          </div>
          <button onClick={logout}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/15 text-slate-200 hover:text-rose-300 text-sm font-medium flex items-center gap-2 border border-slate-700/50 hover:border-rose-500/40"
            aria-label="Log out">
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
};
