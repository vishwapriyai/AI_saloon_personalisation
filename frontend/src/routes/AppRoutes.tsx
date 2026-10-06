import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Layouts
import { CustomerLayout } from '../layouts/CustomerLayout';
import { AdminLayout } from '../layouts/AdminLayout';
import { StylistLayout } from '../layouts/StylistLayout';

// Customer Pages
import { LoginLookupPage } from '../pages/customer/LoginLookupPage';
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

// Stylist Pages
import { StylistDashboardPage } from '../pages/stylist/StylistDashboardPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Root redirect to Customer Portal */}
      <Route path="/" element={<Navigate to="/customer/login" replace />} />

      {/* Public share link opened from WhatsApp / SMS */}
      <Route path="/r/:code" element={<SharedReferralPage />} />

      {/* CUSTOMER APPLICATION ROUTES */}
      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<Navigate to="/customer/login" replace />} />
        <Route path="login" element={<LoginLookupPage />} />
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

      {/* ADMIN APPLICATION ROUTES */}
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

      {/* STYLIST APPLICATION ROUTES */}
      <Route path="/stylist" element={<StylistLayout />}>
        <Route index element={<StylistDashboardPage />} />
        <Route path="customers" element={<StylistDashboardPage />} />
        <Route path="appointments" element={<StylistDashboardPage />} />
        <Route path="style/:id" element={<CuttingInstructionsPage />} />
        <Route path="instructions" element={<CuttingInstructionsPage />} />
        <Route path="service-completion" element={<BeforeAfterConfirmationPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/customer/login" replace />} />
    </Routes>
  );
};
