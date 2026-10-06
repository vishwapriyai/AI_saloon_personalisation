import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Layouts
import { CustomerLayout } from '../layouts/CustomerLayout';
import { AdminLayout } from '../layouts/AdminLayout';
import { StylistLayout } from '../layouts/StylistLayout';

// Customer Pages
import { CustomerLoginPage } from '../pages/customer/CustomerLoginPage';
import { PhotoUploadPage } from '../pages/customer/PhotoUploadPage';
import { ServiceCategoryPage } from '../pages/customer/ServiceCategoryPage';
import { GeneratePage } from '../pages/customer/GeneratePage';
import { RecommendationsPage } from '../pages/customer/RecommendationsPage';
import { CuttingInstructionsPage } from '../pages/customer/CuttingInstructionsPage';
import { BeforeAfterConfirmationPage } from '../pages/customer/BeforeAfterConfirmationPage';
import { CustomerHistoryPage } from '../pages/customer/CustomerHistoryPage';
import { CustomerProfilePage } from '../pages/customer/CustomerProfilePage';

// Admin Pages
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { CapacityAnalyticsPage } from '../pages/admin/CapacityAnalyticsPage';
import { CustomersPage } from '../pages/admin/CustomersPage';
import { CampaignsPage } from '../pages/admin/CampaignsPage';

// Public Pages
import { SharedReferralPage } from '../pages/public/SharedReferralPage';

// Staff Pages & route guard
import { StaffLoginPage } from '../pages/staff/StaffLoginPage';
import { StaffCustomersPage } from '../pages/staff/StaffCustomersPage';
import { RequireAuth } from '../auth/RequireAuth';

// Stylist Pages
import { StylistDashboardPage } from '../pages/stylist/StylistDashboardPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Root redirect to Customer Portal */}
      <Route path="/" element={<Navigate to="/customer/login" replace />} />

      {/* Public share link opened from WhatsApp / SMS */}
      <Route path="/r/:code" element={<SharedReferralPage />} />

      {/* Separate login pages: customers and salon staff (stylist / admin) */}
      <Route path="/staff/login" element={<StaffLoginPage />} />
      <Route path="/staff" element={<Navigate to="/staff/login" replace />} />

      {/* CUSTOMER APPLICATION ROUTES */}
      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<Navigate to="/customer/login" replace />} />
        <Route path="login" element={<CustomerLoginPage />} />
        {/* Everything else needs a logged-in customer, or staff serving a selected customer */}
        <Route element={<RequireAuth need="customer-area" />}>
        <Route path="photo" element={<PhotoUploadPage />} />
        <Route path="service" element={<ServiceCategoryPage />} />
        <Route path="style-category" element={<ServiceCategoryPage />} />
        <Route path="generate" element={<GeneratePage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
        <Route path="style/:styleId" element={<RecommendationsPage />} />
        <Route path="instructions" element={<CuttingInstructionsPage />} />
        <Route path="confirmation" element={<BeforeAfterConfirmationPage />} />
        <Route path="history" element={<CustomerHistoryPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
        </Route>
      </Route>

      {/* ADMIN APPLICATION ROUTES */}
      <Route element={<RequireAuth need="admin" />}>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomersPage />} />
        <Route path="styles" element={<RecommendationsPage />} />
        <Route path="analytics/capacity" element={<CapacityAnalyticsPage />} />
        <Route path="analytics/peak-hours" element={<CapacityAnalyticsPage />} />
        <Route path="analytics/customers" element={<CustomersPage />} />
        <Route path="analytics/services" element={<AdminDashboardPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="coupons" element={<CampaignsPage />} />
        <Route path="referrals" element={<CustomerHistoryPage />} />
        <Route path="membership" element={<CustomerProfilePage />} />
        <Route path="loyalty" element={<CustomerProfilePage />} />
        <Route path="settings" element={<AdminDashboardPage />} />
      </Route>
      </Route>

      {/* STYLIST APPLICATION ROUTES */}
      <Route element={<RequireAuth need="staff" />}>
      <Route path="/stylist" element={<StylistLayout />}>
        <Route index element={<Navigate to="/stylist/customers" replace />} />
        <Route path="customers" element={<StaffCustomersPage />} />
        <Route path="appointments" element={<StylistDashboardPage />} />
        <Route path="style/:id" element={<CuttingInstructionsPage />} />
        <Route path="instructions" element={<CuttingInstructionsPage />} />
        <Route path="service-completion" element={<BeforeAfterConfirmationPage />} />
      </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/customer/login" replace />} />
    </Routes>
  );
};
