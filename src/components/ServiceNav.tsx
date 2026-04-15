import { useLocation, useNavigate } from 'react-router-dom';
import './ServiceNav.css';

const HIDE_ON_ROUTES = ['/alerts', '/settings', '/configuration', '/activity'];

export default function ServiceNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isGlobalRoute = HIDE_ON_ROUTES.some(route =>
    location.pathname === route
  );
  // Hide on plain /tenants (data sources list), but show on contextual routes
  const isTenantsList = location.pathname === '/tenants';
  const shouldShow = !isGlobalRoute && !isTenantsList;

  if (!shouldShow) return null;

  // Extract tenant context from URL
  const match = location.pathname.match(/^\/tenants\/([^/]+)\/([^/]+)\//);
  const tenantId = match?.[1] ?? null;
  const serviceType = match?.[2] ?? null;
  const isContextualRoute = !!match;

  const buildRoute = (basePath: string): string => {
    if (isContextualRoute && tenantId && serviceType) {
      return `/tenants/${tenantId}/${serviceType}${basePath}`;
    }
    return basePath;
  };

  const tabs = [
    { label: 'Overview', route: buildRoute('/overview') },
    { label: 'Protection', route: buildRoute('/protection'), exact: true },
    { label: 'Recovery', route: buildRoute('/protection/recovery') },
    { label: 'Settings', route: buildRoute('/protection/settings') },
  ];

  const isActive = (route: string, exact?: boolean) => {
    if (exact) {
      return location.pathname === route;
    }
    return location.pathname.startsWith(route);
  };

  return (
    <div className="service-nav">
      {tabs.map((tab) => (
        <div
          key={tab.route}
          className={`nav-tab ${isActive(tab.route, tab.exact) ? 'active' : ''}`}
          onClick={() => navigate(tab.route)}
        >
          {tab.label}
        </div>
      ))}
    </div>
  );
}
