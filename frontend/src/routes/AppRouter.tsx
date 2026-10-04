import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { NotFound } from '@/components';
import { AppShell } from '@/layout/AppShell';
import {
  DealsListPage,
  CompanyRoutes,
  DealDetailPage,
  FollowUpsPage,
  LegacyExporterRoutes,
  PipelinePage,
  QualificationCriteriaPage,
} from '@/modules/onboarding';
import { SettingsRoutes } from '@/modules/settings';
import { LoginPage } from '@/pages/auth/LoginPage';
import { HomePage } from '@/pages/HomePage';

import { ProtectedRoute } from './ProtectedRoute';

/** `/advances?…` → `/deals?…`, keeping the query (a tab, a saved list). */
function LegacyAdvancesRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/deals${search}`} replace />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/companies/*" element={<CompanyRoutes />} />
            <Route path="/follow-ups" element={<FollowUpsPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/deals" element={<DealsListPage />} />
            {/* The list was called Advances for a while; old links still land. */}
            <Route path="/advances" element={<LegacyAdvancesRedirect />} />
            <Route path="/deals/:dealId" element={<DealDetailPage />} />
            {/* `/settings/qualification-criteria` is a static path and
                `/settings/*` a splat, so React Router's ranking picks the
                specific one first whatever order they appear in here. */}
            <Route path="/settings/qualification-criteria" element={<QualificationCriteriaPage />} />
            <Route path="/settings/*" element={<SettingsRoutes />} />
            <Route path="/exporters/*" element={<LegacyExporterRoutes />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
