import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth';
import { refreshDataSources } from '../services/datasource';
import './Auth.css';

// OAuth transition state lives in sessionStorage now (dies with the tab).
// Old in-flight redirects may still have data in localStorage — fall back
// once and clean up.
function readTransition(key: string): string | null {
  const v = sessionStorage.getItem(key);
  if (v !== null) return v;
  const legacy = localStorage.getItem(key);
  if (legacy !== null) localStorage.removeItem(key);
  return legacy;
}

// Reject anything that isn't a same-origin in-app path. See
// AzureDatasourceCallback for the open-redirect rationale.
function safeInAppPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

export default function DatasourceCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState('');
  const returnTo = safeInAppPath(
    searchParams.get('return_to') || readTransition('consent_return_to'),
    '/tenants',
  );

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // The /adminconsent endpoint always returns its result on the query
    // string (response_mode is not honored by that endpoint), so we can't
    // route this through the URL fragment. Snapshot the params and purge
    // the URL immediately so tenant id / admin_consent / state can't leak
    // via history or Referer.
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, '', window.location.pathname);

    const tenant = params.get('tenant');
    const adminConsent = params.get('admin_consent');
    const state = params.get('state') || undefined;
    const authError = params.get('error');
    sessionStorage.removeItem('consent_return_to');

    if (authError) {
      const errorDesc = params.get('error_description') || authError;
      setError(`Connection error: ${errorDesc}`);
      return;
    }

    if (tenant && adminConsent === 'True') {
      // Admin consent was granted — call backend to store credentials and trigger discovery
      (async () => {
        try {
          await authService.handleDatasourceConsentCallback(tenant, state);
          await refreshDataSources();
          navigate(returnTo);
        } catch (err: any) {
          console.error('Datasource consent callback error:', err);
          setError(`Failed to connect data source: ${err.message}`);
        }
      })();
    } else {
      setError('Admin consent was not granted or required parameters are missing.');
    }
  }, [navigate, returnTo, searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title" style={{marginBottom: 24}}>Connecting data source...</h1>

        {error ? (
          <div style={{color: '#dc2626', fontSize: 14}}>
            <p>{error}</p>
            <button className="microsoft-btn" onClick={() => navigate(returnTo)} style={{marginTop: 16}}>
              Back to Data Sources
            </button>
          </div>
        ) : (
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <div className="spinner-large" style={{borderTopColor: '#D31245'}}></div>
          </div>
        )}
      </div>
    </div>
  );
}
