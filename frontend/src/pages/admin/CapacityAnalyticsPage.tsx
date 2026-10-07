import React, { useEffect, useState } from 'react';
import { getCapacityAnalytics } from '../../api/client';

export const CapacityAnalyticsPage: React.FC = () => {
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hours = Array.from({ length: 12 }, (_, i) => i + 9); // 9 AM to 8 PM

  useEffect(() => {
    getCapacityAnalytics()
      .then((res) => setHeatmapData(res.heatmap || []))
      .catch((err) => console.error(err));
  }, []);

  const getCellColor = (utilization: number) => {
    if (utilization >= 80) return 'bg-rose-500/80 border-rose-400/50 text-slate-950 font-bold';
    if (utilization >= 60) return 'bg-amber-500/70 border-amber-400/50 text-slate-950 font-bold';
    if (utilization >= 40) return 'bg-emerald-500/50 border-emerald-400/30 text-slate-950';
    return 'bg-slate-900 border-slate-800 text-slate-500';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Salon Capacity Analytics</h1>
        <p className="text-slate-400 text-xs sm:text-sm">7x12 Day vs Hour Traffic Heatmap & Chair Utilization Matrix</p>
      </div>

      {/* Heatmap Legend */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-wrap items-center gap-6 text-xs">
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 rounded bg-slate-900 border border-slate-800"></div>
          <span className="text-slate-400">Lean Hours (&lt;40% Util)</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 rounded bg-emerald-500/50 border border-emerald-400/30"></div>
          <span className="text-slate-300">Moderate (40-60%)</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 rounded bg-amber-500/70"></div>
          <span className="text-slate-200">High (60-80%)</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 rounded bg-rose-500/80"></div>
          <span className="text-rose-300 font-semibold">Peak (80-100%)</span>
        </div>
      </div>

      {/* Day vs Hour Heatmap Matrix */}
      <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-2xl overflow-x-auto">
        <table className="w-full text-center border-collapse min-w-[700px]">
          <thead>
            <tr>
              <th className="p-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Day / Hour</th>
              {hours.map((hr) => (
                <th key={hr} className="p-2 text-xs font-semibold text-slate-400">
                  {hr}:00
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day} className="border-t border-slate-800/60">
                <td className="p-3 text-left text-xs font-bold text-amber-400">{day}</td>
                {hours.map((hr) => {
                  const item = heatmapData.find((d) => d.day === day && d.hour === hr);
                  const util = item ? item.utilization_pct : 30;
                  return (
                    <td key={hr} className="p-1.5">
                      <div className={`p-2.5 rounded-xl border text-xs transition-all ${getCellColor(util)}`}>
                        {util}%
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
