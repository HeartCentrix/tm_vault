import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Signin from './pages/Signin';
import Signup from './pages/Signup';
import AuthCallback from './pages/AuthCallback';
import DatasourceCallback from './pages/DatasourceCallback';
import AzureDatasourceCallback from './pages/AzureDatasourceCallback';
import PowerBICallback from './pages/PowerBICallback';
import Tenants from './pages/Tenants';
import Overview from './pages/Overview';
import Protection from './pages/Protection';
import Recovery from './pages/Recovery';
import Activity from './pages/Activity';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import SettingsStoragePage from './pages/SettingsStorage';
import ErrorBoundary from './components/ErrorBoundary';
import GlobalSearch from './pages/GlobalSearch';
import Configuration from './pages/Configuration';

// The access token lives in an HttpOnly cookie that JS can't read (so XSS
// can't exfiltrate it). Use the non-credential `user` breadcrumb as a UX
// hint — actual auth is enforced by the backend on every request, and a
// stale breadcrumb just yields 401s that the API caller can react to.
const isAuthenticated = () => {
  return !!localStorage.getItem('user');
};

function AutoRedirect() {
  if (isAuthenticated()) {
    return <Navigate to="/tenants" replace />;
  }
  return <Navigate to="/signin" replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/signin" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  // Global listener for the stale-tenant signal emitted by API callers
  // when the backend 404s on a cached tenant id (common after a DB
  // reset changed the tenant UUID). Route the user back to /tenants
  // so they re-select a live tenant — no hard reload, no lost session.
  useEffect(() => {
    const onStale = () => {
      try {
        // Only redirect if user is authenticated — otherwise the
        // normal /signin flow handles it.
        if (localStorage.getItem('user')) {
          window.location.assign('/tenants');
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('tm:tenant-stale', onStale);
    return () => window.removeEventListener('tm:tenant-stale', onStale);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AutoRedirect />} />
        <Route path="/signin" element={<Signin />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/datasource-callback" element={<DatasourceCallback />} />
        <Route path="/azure-datasource-callback" element={<AzureDatasourceCallback />} />
        <Route path="/power-bi-callback" element={<PowerBICallback />} />

        {/* Protected routes with layout */}
        <Route path="/" element={<Layout />}>
          <Route
            path="/tenants"
            element={
              <ProtectedRoute>
                <Tenants />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tenants/:tenantId/:serviceType/overview"
            element={
              <ProtectedRoute>
                <Overview />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tenants/:tenantId/:serviceType/protection"
            element={
              <ProtectedRoute>
                <Protection />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tenants/:tenantId/:serviceType/protection/recovery"
            element={
              <ProtectedRoute>
                <Recovery />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tenants/:tenantId/:serviceType/protection/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tenants/:tenantId/:serviceType/global-search"
            element={
              <ProtectedRoute>
                <GlobalSearch />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute>
                <Activity />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <ProtectedRoute>
                <Alerts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/storage"
            element={
              <ProtectedRoute>
                <ErrorBoundary label="Storage">
                  <SettingsStoragePage />
                </ErrorBoundary>
              </ProtectedRoute>
            }
          />
          <Route
            path="/configuration"
            element={
              <ProtectedRoute>
                <Configuration />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
