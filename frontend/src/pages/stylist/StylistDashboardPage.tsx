import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Volume2, ArrowRight } from 'lucide-react';

export const StylistDashboardPage: React.FC = () => {
  const navigate = useNavigate();

  const appointments = [
    { id: 1, customer: 'Alex Mercer', service: 'Haircut & Styling', style: 'Low Taper Fade + Textured Top', time: '10:30 AM', status: 'IN_PROGRESS' },
    { id: 2, customer: 'Rohan Kapoor', service: 'Beard Trim & Sculpting', style: 'Sharp Boxed Beard', time: '11:15 AM', status: 'WAITING' },
    { id: 3, customer: 'David Miller', service: 'Haircut + Facial', style: 'Corporate Ivy League Crop', time: '12:00 PM', status: 'SCHEDULED' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Today's Appointment Queue</h2>
          <p className="text-slate-400 text-xs sm:text-sm">Station #4 • Stylist Rahul Sharma</p>
        </div>

        <button
          onClick={() => navigate('/customer/instructions')}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-sm flex items-center space-x-2"
        >
          <Volume2 className="w-4 h-4" />
          <span>Open Cutting Audio Player</span>
        </button>
      </div>

      <div className="space-y-4">
        {appointments.map((app) => (
          <div
            key={app.id}
            className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 font-bold flex items-center justify-center">
                <Scissors className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-bold text-white text-lg">{app.customer}</h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-amber-400 font-medium border border-slate-700">
                    {app.time}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{app.service} • Style: <strong className="text-slate-200">{app.style}</strong></p>
              </div>
            </div>

            <button
              onClick={() => navigate('/customer/instructions')}
              className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold px-5 py-3 rounded-2xl text-sm flex items-center justify-center space-x-2 border border-slate-700 touch-target-large"
            >
              <span>View Cutting Instructions</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
