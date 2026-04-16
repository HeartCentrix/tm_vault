import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth';
import './Auth.css';

export default function PowerBICallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState('');
  const tenantId = searchParams.get('tenantId') || localStorage.getItem('power_bi_tenant_id');
  const serviceType = searchParams.get('serviceType') || localStorage.getItem('power_bi_service_type');
  const fallbackReturnTo = tenantId && serviceType
    ? `/tenants/${tenantId}/${serviceType}/protection/settings`
    : '/settings';
  const returnTo = searchParams.get('return_to') || localStorage.getItem('consent_return_to') || fallbackReturnTo;

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state') || undefined;
    const expectedState = localStorage.getItem('power_bi_oauth_state');
    const authError = searchParams.get('error');
    localStorage.removeItem('consent_return_to');
    localStorage.removeItem('power_bi_tenant_id');
    localStorage.removeItem('power_bi_service_type');
    localStorage.removeItem('power_bi_oauth_state');

    if (authError) {
      const errorDesc = searchParams.get('error_description') || authError;
      setError(`Power BI connection error: ${errorDesc}`);
      return;
    }

    if (!tenantId) {
      setError('Missing tenant ID for Power BI onboarding.');
      return;
    }

    if (expectedState && state && expectedState !== state) {
      setError('Power BI sign-in state did not match. Please try connecting again.');
      return;
    }

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
