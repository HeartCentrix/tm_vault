import { useLocation, useNavigate } from 'react-router-dom';
import './ServiceNav.css';

export default function ServiceNav() {
  const location = useLocation();
  const navigate = useNavigate();

  // Tabs are meaningful only inside a tenant/service context
  // (/tenants/:tenantId/:serviceType/...). Outside that — /settings/*,
  // /configuration, /activity, /alerts, /tenants list, auth pages —
  // the nav has nothing valid to link to, so hide it entirely. This
  // prevents navigating to unregistered paths like /overview, which
  // render as blank pages.
  const match = location.pathname.match(/^\/tenants\/([^/]+)\/([^/]+)\//);
  if (!match) return null;

  const tenantId = match[1];
  const serviceType = match[2];

  const buildRoute = (basePath: string): string =>
    `/tenants/${tenantId}/${serviceType}${basePath}`;

  const tabs = [
    { label: 'Overview', route: buildRoute('/overview') },
    { label: 'Protection', route: buildRoute('/protection'), exact: true },
    { label: 'Recovery', route: buildRoute('/protection/recovery'), exact: true },
    { label: 'Settings', route: buildRoute('/protection/settings'), exact: true },
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
