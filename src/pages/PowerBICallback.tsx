import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth';
import './Auth.css';

// OAuth transition state (state nonce, tenant id, service type, return_to)
// lives in sessionStorage so it dies with the tab. Old in-flight redirects
// from before the storage migration may still have data in localStorage —
// fall back once and clean it up.
function readTransition(key: string): string | null {
  const v = sessionStorage.getItem(key);
  if (v !== null) return v;
  const legacy = localStorage.getItem(key);
  if (legacy !== null) localStorage.removeItem(key);
  return legacy;
}

// Reject anything that isn't a same-origin in-app path. `return_to` is
// attacker-controllable via the OAuth initiation URL (and via XSS into
// sessionStorage), and React Router's navigate() will follow an absolute
// URL like `https://evil.com` as a full navigation — that turns a
// legitimate sign-in into a phishing redirect.
function safeInAppPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

export default function PowerBICallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState('');
  const tenantId = searchParams.get('tenantId') || readTransition('power_bi_tenant_id');
  const serviceType = searchParams.get('serviceType') || readTransition('power_bi_service_type');
  const fallbackReturnTo = tenantId && serviceType
    ? `/tenants/${tenantId}/${serviceType}/protection/settings`
    : '/settings';
  const returnTo = safeInAppPath(
    searchParams.get('return_to') || readTransition('consent_return_to') || fallbackReturnTo,
    '/settings',
  );

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // OAuth code arrives in the URL fragment (response_mode=fragment).
    // Snapshot it and purge the URL on the same tick so the code never
    // ends up in history, Referer, or any analytics that reads location.
    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const fragmentParams = new URLSearchParams(rawHash);
    const params = fragmentParams.has('code') || fragmentParams.has('error')
      ? fragmentParams
      : searchParams;
    window.history.replaceState({}, '', window.location.pathname);

    const code = params.get('code');
    const state = params.get('state') || undefined;
    const authError = params.get('error');
    sessionStorage.removeItem('consent_return_to');
    sessionStorage.removeItem('power_bi_tenant_id');
    sessionStorage.removeItem('power_bi_service_type');
    // Legacy: a previous version stored the CSRF nonce here. The backend's
    // HttpOnly state cookie is now authoritative — clean up any stragglers.
    sessionStorage.removeItem('power_bi_oauth_state');
    localStorage.removeItem('power_bi_oauth_state');

    if (authError) {
      const errorDesc = params.get('error_description') || authError;
      setError(`Power BI connection error: ${errorDesc}`);
      return;
    }

    if (!tenantId) {
      setError('Missing tenant ID for Power BI onboarding.');
      return;
    }

    // CSRF state validation happens server-side: the backend compares the
    // `state` we POST against the HttpOnly cookie it set when /power-bi/url
    // was called. The check is authoritative there — no client-side
    // comparison needed (and any client-side check would be defeatable by
    // XSS that writes a known value to localStorage / sessionStorage).

    if (code) {
      (async () => {
        try {
          await authService.handlePowerBICallback(tenantId, code, state);
          navigate(returnTo);
        } catch (err: any) {
          console.error('Power BI callback error:', err);
          setError(`Failed to connect Power BI: ${err.message}`);
        }
      })();
    } else {
      setError('Missing authorization code from Power BI sign-in.');
    }
  }, [navigate, returnTo, searchParams, tenantId]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title" style={{marginBottom: 24}}>Connecting Power BI...</h1>

        {error ? (
          <div style={{color: '#dc2626', fontSize: 14}}>
            <p>{error}</p>
            <button className="microsoft-btn" onClick={() => navigate(returnTo)} style={{marginTop: 16}}>
              Back to Settings
            </button>
          </div>
        ) : (
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <div className="spinner-large" style={{borderTopColor: '#f59e0b'}}></div>
          </div>
        )}
      </div>
    </div>
  );
}
