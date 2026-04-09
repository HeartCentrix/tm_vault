import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { saveNavigationState } from '../services/navState';

const SERVICE_PREFIX = '/tenants/';

export function useTrackNavigation() {
  const location = useLocation();

  useEffect(() => {
    const pathname = location.pathname;

    // Track service sub-routes
    if (pathname.startsWith(SERVICE_PREFIX)) {
      const match = pathname.match(/^\/tenants\/([^/]+)\/([^/]+)(\/.*)?$/);
      if (match) {
        const [, tenantId, serviceType, subRoute] = match;
        saveNavigationState({
          tenantId,
          serviceType,
          subRoute: subRoute || '/overview',
        });
      }
    }
  }, [location.pathname]);
}
