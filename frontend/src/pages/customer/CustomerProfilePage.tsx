import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, ShieldCheck } from 'lucide-react';
import { getCustomerProfile, type CustomerProfile } from '../../api/client';
import { currentCustomerId } from '../../auth/session';
import { CustomerFullProfile, type RepeatableStyle } from '../../components/CustomerFullProfile';
import { preparePreviousStyle } from '../../utils/previousStyle';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

/** The logged-in customer's own profile: overview, styles, service history, gallery, loyalty and membership. */
export const CustomerProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const customerId = currentCustomerId();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    let active = true;
    getCustomerProfile(customerId).then((p) => { if (active) setProfile(p); }).catch(() => { /* shown by the profile below */ });
    return () => { active = false; };
  }, [customerId]);

  const repeat = async (style: RepeatableStyle) => {
    await preparePreviousStyle(style, customerId);
    navigate('/customer/instructions');
  };

  const loyalty = profile && (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl flex items-center space-x-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
          <Award className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase">Loyalty Points</p>
          <h3 className="text-2xl font-bold text-white">{profile.loyalty_points} Points</h3>
        </div>
      </div>
      <div className="bg-slate-800/60 border border-slate-700/60 p-5 rounded-2xl flex items-center space-x-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase">Membership</p>
          <h3 className="text-2xl font-bold text-white">{profile.membership ? profile.membership.name : 'Not a member'}</h3>
          {profile.membership?.valid_until && (
            <p className="text-[11px] text-slate-400">Valid until {formatDate(profile.membership.valid_until)}</p>
          )}
          {!profile.membership && profile.member_since && (
            <p className="text-[11px] text-slate-400">Customer since {formatDate(profile.member_since)}</p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 py-4">
      <CustomerFullProfile customerId={customerId} onRepeat={repeat} header={loyalty} />
    </div>
  );
};
