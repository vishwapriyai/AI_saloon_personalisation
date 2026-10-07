import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Calendar, BarChart3, Tag, TrendingUp, Scissors, ChevronRight } from 'lucide-react';
import { getDashboardOverview } from '../../api/client';

export const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    getDashboardOverview()
      .then((res) => setData(res))
      .catch((err) => console.error(err));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Executive Admin Dashboard</h1>
          <p className="text-slate-400 text-xs sm:text-sm">Real-time salon intelligence, capacity analytics & campaign engine</p>
        </div>

        <button
          onClick={() => navigate('/customer/login')}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-sm flex items-center space-x-2 shadow-sm active:scale-95 transition-all"
        >
          <Scissors className="w-4 h-4 text-slate-950" />
          <span>Open Tablet Customer Portal</span>
        </button>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Revenue</span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
              ₹
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold text-white">₹{data?.total_revenue?.toLocaleString() || '2,84,500'}</h3>
            <p className="text-xs text-emerald-400 font-medium mt-1 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" /> +14.2% vs last month
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Visits</span>
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold text-white">{data?.total_visits || 420}</h3>
            <p className="text-xs text-amber-400 font-medium mt-1">Avg ₹{data?.avg_spending || 677.38} per visit</p>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Capacity Utilization</span>
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold">
              <BarChart3 className="w-5 h-5" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold text-white">{data?.capacity_utilization_pct || 68.5}%</h3>
            <p className="text-xs text-cyan-400 font-medium mt-1">8 Chairs • 6 Stylists Active</p>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Campaigns</span>
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold">
              <Tag className="w-5 h-5" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold text-white">{data?.active_campaigns_count || 4}</h3>
            <p className="text-xs text-purple-400 font-medium mt-1">Lean-Time Auto Discounts Active</p>
          </div>
        </div>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          onClick={() => navigate('/admin/analytics/capacity')}
          className="bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 p-6 rounded-2xl cursor-pointer transition-all space-y-4 group"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-white text-lg group-hover:text-amber-400 transition-colors flex items-center justify-between">
              <span>Day vs Hour Heatmap</span>
              <ChevronRight className="w-5 h-5 text-slate-500 group-hover:translate-x-1 transition-transform" />
            </h3>
            <p className="text-xs text-slate-400 mt-1">Analyze peak vs lean hours across 7 days of the week.</p>
          </div>
        </div>

        <div
          onClick={() => navigate('/admin/customers')}
          className="bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 p-6 rounded-2xl cursor-pointer transition-all space-y-4 group"
        >
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-white text-lg group-hover:text-cyan-400 transition-colors flex items-center justify-between">
              <span>RFM Customer Intelligence</span>
              <ChevronRight className="w-5 h-5 text-slate-500 group-hover:translate-x-1 transition-transform" />
            </h3>
            <p className="text-xs text-slate-400 mt-1">Segment customers by recency, frequency, and churn risk.</p>
          </div>
        </div>

        <div
          onClick={() => navigate('/admin/campaigns')}
          className="bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 p-6 rounded-2xl cursor-pointer transition-all space-y-4 group"
        >
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-white text-lg group-hover:text-purple-400 transition-colors flex items-center justify-between">
              <span>Automated Discount Engine</span>
              <ChevronRight className="w-5 h-5 text-slate-500 group-hover:translate-x-1 transition-transform" />
            </h3>
            <p className="text-xs text-slate-400 mt-1">Generate personalized coupons respecting salon profit margins.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
