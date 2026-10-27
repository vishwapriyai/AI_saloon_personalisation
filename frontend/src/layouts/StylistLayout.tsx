import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Scissors, LogOut, LayoutDashboard, Users, CalendarClock } from 'lucide-react';
import { clearSession, getSession, isAdmin } from '../auth/session';
import { BRAND } from '../config/brand';

export const StylistLayout: React.FC = () => {
  const navigate = useNavigate();
  const session = getSession();
  const initials = (session?.name || 'S').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const logout = () => {
    clearSession();
    navigate('/staff/login', { replace: true });
  };

  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-colors ${
      isActive ? 'bg-[#244a37] text-[#ffffff] shadow-sm' : 'text-[#4f6b5a] hover:bg-[#eef3ee] hover:text-[#1a2a20]'
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-[#ffffff] font-sans text-[#1a2a20]">
      <header className="sticky top-0 z-40 border-b border-[#ebf0ec] bg-[#ffffff]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#244a37] to-[#3a6b52] shadow-md shadow-[#244a37]/20">
                <Scissors aria-hidden="true" className="size-4 text-[#ffffff]" />
              </span>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-bold text-[#1a2a20]">{BRAND.name}</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#8a9a92]">Stylist workstation</p>
              </div>
            </div>
            <span aria-hidden="true" className="hidden h-6 w-px bg-[#ebf0ec] md:block" />
            <nav className="flex items-center gap-1">
              <NavLink to="/stylist/customers" className={tab}><Users aria-hidden="true" className="size-4" /> <span className="hidden sm:inline">Customers</span></NavLink>
              <NavLink to="/stylist/appointments" className={tab}><CalendarClock aria-hidden="true" className="size-4" /> <span className="hidden sm:inline">Appointments</span></NavLink>
            </nav>
          </div>

          {/* Signed-in staff member and Logout, top-right */}
          <div className="flex shrink-0 items-center gap-1.5">
            {isAdmin(session) && (
              <button onClick={() => navigate('/admin/dashboard')}
                className="grid size-9 place-items-center rounded-full text-[#4f6b5a] transition-colors hover:bg-[#eef3ee] hover:text-[#1a2a20] cursor-pointer"
                aria-label="Admin dashboard" title="Admin dashboard">
                <LayoutDashboard className="size-4" />
              </button>
            )}
            <div className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3">
              <span className="grid size-8 place-items-center rounded-full bg-[#244a37] text-xs font-bold text-[#f3d27a]">{initials}</span>
              <div className="hidden leading-tight md:block">
                <p className="text-sm font-semibold text-[#1a2a20]">{session?.name}</p>
                <p className="text-[11px] text-[#7f968a]">{session?.role}</p>
              </div>
            </div>
            <button onClick={logout}
              className="grid size-9 place-items-center rounded-full text-[#6c7e73] transition-colors hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
              aria-label="Log out" title="Log out">
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
};
