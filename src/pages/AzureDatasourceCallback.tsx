import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth';
import { refreshDataSources } from '../services/datasource';
import './Auth.css';

export default function AzureDatasourceCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState('');
  const returnTo = searchParams.get('return_to') || localStorage.getItem('consent_return_to') || '/tenants';

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state') || undefined;
    const authError = searchParams.get('error');
    localStorage.removeItem('consent_return_to');

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
