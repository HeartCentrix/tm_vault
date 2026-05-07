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

// Reject anything that isn't a same-origin in-app path. `return_to` is read
// from the URL query (which an attacker can craft into the OAuth initiation
// URL) and from sessionStorage (XSS-writable). Without this guard, an
// attacker could land the post-OAuth navigation on an arbitrary URL,
// turning a legitimate Microsoft sign-in into a phishing redirect.
function safeInAppPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  // Must start with exactly one '/' and no scheme. Reject protocol-relative
  // '//evil.com', backslash tricks '/\evil.com', and absolute URLs.
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

export default function AzureDatasourceCallback() {
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

    if (authError) {
      setError(`Connection error: ${authError}`);
      return;
    }

    if (code) {
      (async () => {
        try {
          await authService.handleAzureDatasourceCallback(code, state);
          await refreshDataSources();
          navigate(returnTo);
        } catch (err: any) {
          console.error('Azure datasource callback error:', err);
          setError(`Failed to connect Azure: ${err.message}`);
        }
      })();
    }
  }, [navigate, returnTo, searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title" style={{marginBottom: 24}}>Connecting Azure...</h1>

        {error ? (
          <div style={{color: '#dc2626', fontSize: 14}}>
            <p>{error}</p>
            <button className="microsoft-btn" onClick={() => navigate(returnTo)} style={{marginTop: 16}}>
              Back to Data Sources
            </button>
          </div>
        ) : (
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <div className="spinner-large" style={{borderTopColor: '#0078d4'}}></div>
          </div>
        )}
      </div>
    </div>
  );
}
