import { useNavigate, useLocation } from 'react-router-dom';
import { getNavigationState } from '../services/navState';
import './Sidebar.css';

// The tenant sub-routes that are actually registered in App.tsx. `subRoute`
// is free text restored from localStorage, and an unregistered value (''
// from a partially-written state, or a path from an older build) produced a
// target like `/tenants/<id>/<type>` that matches no route — which rendered
// as a blank page and made the Service nav item look dead (BUG-007).
// Anything not on this list falls back to the tenant picker.
const VALID_SERVICE_SUBROUTES = [
  '/overview',
  '/protection',
  '/protection/recovery',
  '/protection/settings',
  '/global-search',
] as const;

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const isRouteActive = (route: string) => {
    if (route === 'service') {
      return location.pathname.startsWith('/tenants') && !['/activity', '/settings', '/configuration'].some(r => location.pathname.startsWith(r));
    }
    return location.pathname.startsWith(route);
  };

  /** Resolve the Service item to a real, registered path. */
  const serviceHref = (): string => {
    const state = getNavigationState();
    if (state?.tenantId && state.serviceType
        && (VALID_SERVICE_SUBROUTES as readonly string[]).includes(state.subRoute)) {
      return `/tenants/${state.tenantId}/${state.serviceType}${state.subRoute}`;
    }
    return '/tenants';
  };

  /** The href a nav item points at — used for the real <a> and for navigate(). */
  const hrefFor = (route: string): string => (route === 'service' ? serviceHref() : route);

  const handleNav = (route: string) => {
    if (route === 'service') {
      navigate(serviceHref());
    } else if (route === '/activity' || route === '/configuration') {
      // Preserve tenant context by including it in the route
      const state = getNavigationState();
      if (state && state.tenantId && state.serviceType) {
        // Navigate to the global page - tenant context is stored for when returning
        navigate(route);
      } else {
        navigate(route);
      }
    } else {
      navigate(route);
    }
  };

  const menuItems = [
    { label: 'Service', route: 'service' },
    { label: 'Activity', route: '/activity' },
    { label: 'Configuration', route: '/configuration' },
    { label: 'Storage', route: '/settings/storage' },
    { label: 'Health', route: '/health' },
  ];

  return (
    <div className="sidebar">
      <div className="logo">
        <svg className="logo-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="m 307,458.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'currentColor', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
          <path d="m 323,455.01367 a 1,1 0 0 0 -0.0508,0.006 1.0001,1.0001 0 0 0 -0.11914,0.0137 1,1 0 0 0 -0.10547,0.0254 1.0001,1.0001 0 0 0 -0.10352,0.0352 1,1 0 0 0 -0.10547,0.0508 1.0001,1.0001 0 0 0 -0.0898,0.0566 1,1 0 0 0 -0.0859,0.0684 1.0001,1.0001 0 0 0 -0.0469,0.0371 l -2,2 a 1,1 0 0 0 0,1.41406 1,1 0 0 0 1.41406,0 L 322,458.42773 v 3.58594 a 1,1 0 0 0 1,1 1,1 0 0 0 1,-1 v -3.58594 l 0.29297,0.29297 a 1,1 0 0 0 1.41406,0 1,1 0 0 0 0,-1.41406 l -1.9707,-1.9707 a 1,1 0 0 0 -0.40625,-0.26563 1.0001,1.0001 0 0 0 -0.002,0 1.0001,1.0001 0 0 0 -0.004,-0.002 1,1 0 0 0 -0.19922,-0.0449 1.0001,1.0001 0 0 0 -0.0273,-0.004 1,1 0 0 0 -0.0977,-0.006 z" style={{fill:'currentColor', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
          <path d="m 307,450.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'currentColor', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
          <path d="m 307,442.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'currentColor', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
          <path d="m 305,438.01367 c -1.6447,0 -3,1.3553 -3,3 v 4 c 0,0.76628 0.29675,1.46716 0.77734,2 -0.48059,0.53284 -0.77734,1.23372 -0.77734,2 v 4 c 0,0.76628 0.29675,1.46716 0.77734,2 -0.48059,0.53284 -0.77734,1.23372 -0.77734,2 v 4 c 0,1.6447 1.3553,3 3,3 h 13.11133 c 1.26351,1.23579 2.98973,2 4.88867,2 3.85414,0 7,-3.14585 7,-7 0,-2.78161 -1.63913,-5.19487 -4,-6.32226 v -3.67774 c 0,-0.76628 -0.29675,-1.46716 -0.77734,-2 0.48059,-0.53284 0.77734,-1.23372 0.77734,-2 v -4 c 0,-1.6447 -1.3553,-3 -3,-3 z m 0,2 h 18 c 0.5713,0 1,0.42871 1,1 v 4 c 0,0.5713 -0.4287,1 -1,1 h -18 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z m 0,8 h 18 c 0.5713,0 1,0.42871 1,1 v 3.07227 c -0.32711,-0.0472 -0.66021,-0.0723 -1,-0.0723 -1.89894,0 -3.62516,0.76421 -4.88867,2 H 305 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z m 18,6 c 2.77327,0 5,2.22674 5,5 0,2.77327 -2.22673,5 -5,5 -1.44074,0 -2.73243,-0.602 -3.64258,-1.56836 a 1,1 0 0 0 -0.16797,-0.18554 C 318.44728,461.38795 318,460.25556 318,459.01367 c 0,-1.25636 0.45901,-2.39958 1.2168,-3.27539 a 1,1 0 0 0 0.0645,-0.0762 c 0.91337,-1.01394 2.23794,-1.64844 3.71875,-1.64844 z m -18,2 h 11.67773 c -0.43469,0.9103 -0.67773,1.92747 -0.67773,3 0,1.07253 0.24304,2.0897 0.67773,3 H 305 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z" style={{fill:'currentColor', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
        </svg>
        <span className="logo-text">TM.vault</span>
      </div>

      {/* Real anchors, not <div>s. As divs these were not keyboard focusable,
          announced as generic containers rather than links, and offered no
          href for middle-click / open-in-new-tab (BUG-007). onClick still
          drives the SPA navigation; the href is what makes them links. */}
      <nav className="nav-menu">
        {menuItems.map((item) => {
          const active = isRouteActive(item.route);
          return (
            <a
              key={item.route}
              href={hrefFor(item.route)}
              className={`nav-item ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                // Let the browser handle modified clicks (new tab/window).
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                handleNav(item.route);
              }}
            >
              <span className="nav-label">{item.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <a
          href="/docs"
          className="footer-link"
          target="_blank"
          rel="noreferrer"
        >
          Docs
        </a>
      </div>
    </div>
  );
}
