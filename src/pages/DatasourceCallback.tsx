import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import './Auth.css';

export default function DatasourceCallback() {
  const navigate = useNavigate();
  const handled = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') || undefined;
    const authError = params.get('error');

    if (authError) {
      setError(`Connection error: ${authError}`);
      return;
    }

    if (code) {
      (async () => {
        try {
          await authService.handleDatasourceCallback(code, state);
          navigate('/tenants');
        } catch (err: any) {
          console.error('Datasource callback error:', err);
          setError(`Failed to connect data source: ${err.message}`);
        }
      })();
    }
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title" style={{marginBottom: 24}}>Connecting data source...</h1>

        {error ? (
          <div style={{color: '#dc2626', fontSize: 14}}>
            <p>{error}</p>
            <button className="microsoft-btn" onClick={() => navigate('/tenants')} style={{marginTop: 16}}>
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
