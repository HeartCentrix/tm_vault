import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import './Auth.css';

export default function AuthCallback() {
  const navigate = useNavigate();
  const handled = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // The OAuth code arrives in the URL fragment (response_mode=fragment),
    // which is never sent to servers. Snapshot it, then immediately purge
    // both the hash and the query string from history so the code can't
    // leak via browser history, the back/forward cache, the Referer header,
    // or any analytics that reads location.href on render. This must run
    // before any await so the purge happens on the same tick as the load.
    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const fragmentParams = new URLSearchParams(rawHash);
    const queryParams = new URLSearchParams(window.location.search);
    const params = fragmentParams.has('code') || fragmentParams.has('error')
      ? fragmentParams
      : queryParams;
    window.history.replaceState({}, '', window.location.pathname);

    const code = params.get('code');
    const state = params.get('state') || undefined;
    const authError = params.get('error');

    if (authError) {
      setError(`Microsoft login error: ${authError}`);
      return;
    }

    if (code) {
      (async () => {
        try {
          await authService.handleOAuthCallback(code, state);
          try {
            await authService.getCurrentUser();
          } catch (e) {
            console.warn('Could not fetch user info:', e);
          }
          navigate('/tenants');
        } catch (err: any) {
          console.error('OAuth callback error:', err);
          setError(`Authentication failed: ${err.message}`);
        }
      })();
    }
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title" style={{marginBottom: 24}}>Signing you in...</h1>

        {error ? (
          <div style={{color: '#dc2626', fontSize: 14}}>
            <p>{error}</p>
            <button className="microsoft-btn" onClick={() => navigate('/signin')} style={{marginTop: 16}}>
              Back to Sign In
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
