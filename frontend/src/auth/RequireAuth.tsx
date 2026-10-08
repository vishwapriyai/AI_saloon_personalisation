import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getSession, isAdmin, isStaff } from './session';

type Need = 'customer-area' | 'staff' | 'admin';

/**
 * Route guard.
 *  - customer-area: a logged-in customer, or staff serving a selected customer
 *  - staff:         any salon staff (stylist, receptionist, admin)
 *  - admin:         salon admin / super admin
 */
export const RequireAuth: React.FC<{ need: Need }> = ({ need }) => {
  const location = useLocation();
  const session = getSession();

  if (!session) {
    const login = need === 'customer-area' ? '/customer/login' : '/staff/login';
    return <Navigate to={login} replace state={{ from: location.pathname }} />;
  }
  if (need === 'admin' && !isAdmin(session)) {
    return <Navigate to={isStaff(session) ? '/stylist/customers' : '/customer/login'} replace />;
  }
  if (need === 'staff' && !isStaff(session)) {
    return <Navigate to="/customer/login" replace />;
  }
  if (session.kind === 'customer' && localStorage.getItem('salon_must_change_password') === '1') {
    // A temporary password must be replaced first (the server enforces this too)
    return <Navigate to="/customer/login" replace />;
  }
  if (need === 'customer-area' && isStaff(session) && !localStorage.getItem('salon_customer_id')) {
    // Staff must pick which customer they are serving first
    return <Navigate to="/stylist/customers" replace />;
  }
  return <Outlet />;
};
