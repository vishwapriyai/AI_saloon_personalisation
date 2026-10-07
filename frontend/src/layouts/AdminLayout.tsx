import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Scissors, BarChart3, Tag, Award, Settings, Menu, X, LogOut, ChevronRight, UserSearch
} from 'lucide-react';
import { clearSession, getSession } from '../auth/session';
import { BRAND } from '../config/brand';

export const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const session = getSession();
  const initials = (session?.name || 'Admin').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const logout = () => {
    clearSession();
    navigate('/staff/login', { replace: true });
  };

  const menuItems = [
    { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Customers', path: '/admin/customers', icon: Users },
    { label: 'Serve a Customer', path: '/stylist/customers', icon: UserSearch },
    { label: 'Hairstyles Catalogue', path: '/admin/styles', icon: Scissors },
    { label: 'Capacity Analytics', path: '/admin/analytics/capacity', icon: BarChart3 },
    { label: 'Campaigns & Coupons', path: '/admin/campaigns', icon: Tag },
    { label: 'Loyalty & Membership', path: '/admin/loyalty', icon: Award },
    { label: 'Settings', path: '/admin/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row font-sans">
      {/* Mobile Topbar */}
      <header className="lg:hidden bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg bg-slate-800 text-slate-300"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <span className="font-bold text-amber-400">{BRAND.name} Admin</span>
        </div>
        <button onClick={logout} className="text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-500/15 text-slate-300 hover:text-rose-300 flex items-center gap-1.5" aria-label="Log out">
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`${
          sidebarOpen ? 'block' : 'hidden'
        } lg:block w-full lg:w-64 bg-slate-900 border-r border-slate-800 flex-shrink-0 flex flex-col justify-between`}
      >
        <div>
          <div className="p-6 border-b border-slate-800 hidden lg:flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center font-bold text-slate-950">
                AI
              </div>
              <div>
                <h2 className="font-bold text-white leading-tight">SALON AI</h2>
                <p className="text-xs text-amber-400 font-medium">Control Dashboard</p>
              </div>
            </div>
          </div>

          <nav className="p-4 space-y-1">
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
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-sm transition-all ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </div>
                  {isActive && <ChevronRight className="w-4 h-4" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Info Footer */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center font-bold text-amber-400 text-sm">
              {initials}
            </div>
            <div>
              <p className="text-xs font-semibold text-white">{session?.name || 'Salon Admin'}</p>
              <p className="text-[10px] text-slate-400">{session?.role}</p>
            </div>
          </div>
          <button onClick={logout} className="px-2.5 py-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 flex items-center gap-1.5 text-xs font-semibold" aria-label="Log out">
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Admin Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
};
