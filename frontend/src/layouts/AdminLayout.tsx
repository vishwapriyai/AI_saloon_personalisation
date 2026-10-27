import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, BarChart3, Tag, Menu, X, LogOut, UserSearch, Scissors
} from 'lucide-react';
import { clearSession, getSession } from '../auth/session';
import { BRAND } from '../config/brand';

export const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Phones / tablets: a slide-in drawer, closed until the menu button is tapped. Desktop: always shown.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const session = getSession();
  const initials = (session?.name || 'Admin').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const logout = () => {
    clearSession();
    navigate('/staff/login', { replace: true });
  };

  const menuItems = [
    // tone: icon tile colours (idle / active)
    { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard, tone: 'bg-[#e4eee7] text-[#2f5d46]', on: 'bg-[#2f5d46] text-[#ffffff]' },
    { label: 'Customers', path: '/admin/customers', icon: Users, tone: 'bg-[#e8f1f7] text-[#2f6f9f]', on: 'bg-[#2f6f9f] text-[#ffffff]' },
    { label: 'Serve a Customer', path: '/stylist/customers', icon: UserSearch, tone: 'bg-[#f1eefb] text-[#6a55b5]', on: 'bg-[#6a55b5] text-[#ffffff]' },
    { label: 'Capacity Analytics', path: '/admin/analytics/capacity', icon: BarChart3, tone: 'bg-[#e3f3f1] text-[#23847a]', on: 'bg-[#23847a] text-[#ffffff]' },
    { label: 'Offers & Coupons', path: '/admin/campaigns', icon: Tag, tone: 'bg-[#fdf3d7] text-[#b07d12]', on: 'bg-[#c9971f] text-[#ffffff]' },
    // Hairstyle catalogue, loyalty & membership and settings pages are not built yet, so they are not listed
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#ffffff] font-sans text-[#1a2a20] lg:flex-row">
      {/* Mobile Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#ebf0ec] bg-[#ffffff]/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="grid size-10 place-items-center rounded-xl text-[#33483c] hover:bg-[#eef3ee] cursor-pointer"
            aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          >
            {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="text-sm font-bold text-[#1a2a20]">{BRAND.name} Admin</span>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-[#6c7e73] hover:bg-rose-50 hover:text-rose-700 cursor-pointer" aria-label="Log out">
          <LogOut className="size-4" /> Logout
        </button>
      </header>

      {/* Backdrop behind the drawer (phones / tablets) */}
      {sidebarOpen && (
        <div aria-hidden="true" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-[#0f1f17]/40 backdrop-blur-[1px] lg:hidden" />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col justify-between overflow-y-auto border-r border-[#ebf0ec] bg-[#fafcfa] transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none ${
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="flex items-center gap-3 px-6 py-6">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-[#244a37] to-[#3a6b52] shadow-md shadow-[#244a37]/25">
              <Scissors aria-hidden="true" className="size-5 text-[#ffffff]" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-[#1a2a20]">{BRAND.name}</p>
              <p className="text-[11px] font-medium text-[#7f968a]">Admin console</p>
            </div>
          </div>

          <p className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a3b3a9]">Menu</p>
          <nav className="space-y-1 px-3 pb-4">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    if (window.innerWidth < 1024) setSidebarOpen(false);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#ffffff] font-semibold text-[#1a2a20] shadow-sm ring-1 ring-[#e4eee7]'
                      : 'text-[#4f6b5a] hover:bg-[#ffffff] hover:text-[#1a2a20]'
                  }`}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${isActive ? `${item.on} shadow-sm` : item.tone}`}>
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Info Footer */}
        <div className="m-3 flex items-center justify-between gap-2 rounded-2xl border border-[#ebf0ec] bg-[#ffffff] p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#244a37] text-xs font-bold text-[#f3d27a]">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#1a2a20]">{session?.name || 'Salon Admin'}</p>
              <p className="truncate text-[10px] text-[#7f968a]">{session?.role}</p>
            </div>
          </div>
          <button onClick={logout} className="grid size-9 shrink-0 place-items-center rounded-lg text-[#7f968a] transition-colors hover:bg-rose-50 hover:text-rose-700 cursor-pointer" aria-label="Log out" title="Log out">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Admin Content Area */}
      <main data-scroll-root className="min-w-0 flex-1 overflow-y-auto bg-[#ffffff] p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
};
