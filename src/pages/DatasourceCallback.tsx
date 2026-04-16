import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth';
import { refreshDataSources } from '../services/datasource';
import './Auth.css';

export default function DatasourceCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState('');
  const returnTo = searchParams.get('return_to') || localStorage.getItem('consent_return_to') || '/tenants';

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const tenant = searchParams.get('tenant');
    const adminConsent = searchParams.get('admin_consent');
    const state = searchParams.get('state') || undefined;
    const authError = searchParams.get('error');
    localStorage.removeItem('consent_return_to');

    if (authError) {
      const errorDesc = searchParams.get('error_description') || authError;
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
            <div className="spinner-large" style={{borderTopColor: '#0d9488'}}></div>
          </div>
        )}
      </div>
    </div>
  );
}
