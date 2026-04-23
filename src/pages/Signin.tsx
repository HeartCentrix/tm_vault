import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import './Auth.css';

export default function Signin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const { url } = await authService.getMicrosoftLoginUrl();
      window.location.href = url;
    } catch (err: any) {
      console.error('Login error:', err);
      setError(`Failed to initiate login: ${err.message}`);
      setLoading(false);
    }
  };

  // Handle OAuth callback when redirected back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') || undefined;
    const authError = params.get('error');

    if (authError) {
      setError(`Microsoft login error: ${authError}`);
      return;
    }

    if (code) {
      (async () => {
        setLoading(true);
        try {
          await authService.handleOAuthCallback(code, state);
          // Tokens are stored - try to get user info but don't block navigation
          try {
            await authService.getCurrentUser();
          } catch (e) {
            console.warn('Could not fetch user info, proceeding anyway:', e);
          }
          navigate('/tenants');
        } catch (err: any) {
          console.error('OAuth callback error:', err);
          setError(`Authentication failed: ${err.message}`);
          setLoading(false);
        }
      })();
    }
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <svg className="auth-logo-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="m 307,458.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'#D31245', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 323,455.01367 a 1,1 0 0 0 -0.0508,0.006 1.0001,1.0001 0 0 0 -0.11914,0.0137 1,1 0 0 0 -0.10547,0.0254 1.0001,1.0001 0 0 0 -0.10352,0.0352 1,1 0 0 0 -0.10547,0.0508 1.0001,1.0001 0 0 0 -0.0898,0.0566 1,1 0 0 0 -0.0859,0.0684 1.0001,1.0001 0 0 0 -0.0469,0.0371 l -2,2 a 1,1 0 0 0 0,1.41406 1,1 0 0 0 1.41406,0 L 322,458.42773 v 3.58594 a 1,1 0 0 0 1,1 1,1 0 0 0 1,-1 v -3.58594 l 0.29297,0.29297 a 1,1 0 0 0 1.41406,0 1,1 0 0 0 0,-1.41406 l -1.9707,-1.9707 a 1,1 0 0 0 -0.40625,-0.26563 1.0001,1.0001 0 0 0 -0.002,0 1.0001,1.0001 0 0 0 -0.004,-0.002 1,1 0 0 0 -0.19922,-0.0449 1.0001,1.0001 0 0 0 -0.0273,-0.004 1,1 0 0 0 -0.0977,-0.006 z" style={{fill:'#D31245', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 307,450.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'#D31245', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 307,442.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'#D31245', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 305,438.01367 c -1.6447,0 -3,1.3553 -3,3 v 4 c 0,0.76628 0.29675,1.46716 0.77734,2 -0.48059,0.53284 -0.77734,1.23372 -0.77734,2 v 4 c 0,0.76628 0.29675,1.46716 0.77734,2 -0.48059,0.53284 -0.77734,1.23372 -0.77734,2 v 4 c 0,1.6447 1.3553,3 3,3 h 13.11133 c 1.26351,1.23579 2.98973,2 4.88867,2 3.85414,0 7,-3.14585 7,-7 0,-2.78161 -1.63913,-5.19487 -4,-6.32226 v -3.67774 c 0,-0.76628 -0.29675,-1.46716 -0.77734,-2 0.48059,-0.53284 0.77734,-1.23372 0.77734,-2 v -4 c 0,-1.6447 -1.3553,-3 -3,-3 z m 0,2 h 18 c 0.5713,0 1,0.42871 1,1 v 4 c 0,0.5713 -0.4287,1 -1,1 h -18 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z m 0,8 h 18 c 0.5713,0 1,0.42871 1,1 v 3.07227 c -0.32711,-0.0472 -0.66021,-0.0723 -1,-0.0723 -1.89894,0 -3.62516,0.76421 -4.88867,2 H 305 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z m 18,6 c 2.77327,0 5,2.22674 5,5 0,2.77327 -2.22673,5 -5,5 -1.44074,0 -2.73243,-0.602 -3.64258,-1.56836 a 1,1 0 0 0 -0.16797,-0.18554 C 318.44728,461.38795 318,460.25556 318,459.01367 c 0,-1.25636 0.45901,-2.39958 1.2168,-3.27539 a 1,1 0 0 0 0.0645,-0.0762 c 0.91337,-1.01394 2.23794,-1.64844 3.71875,-1.64844 z m -18,2 h 11.67773 c -0.43469,0.9103 -0.67773,1.92747 -0.67773,3 0,1.07253 0.24304,2.0897 0.67773,3 H 305 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z" style={{fill:'#D31245', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
          </svg>
          <h1 className="auth-title">TM.vault</h1>
        </div>

        <p className="auth-subtitle">Sign in to your account</p>

        {error && <div style={{color: '#dc2626', fontSize: 14, marginBottom: 16}}>{error}</div>}

        <button className="microsoft-btn" onClick={handleMicrosoftLogin} disabled={loading}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{width: 20, height: 20}}>
            <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
            <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
            <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
            <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
          </svg>
          {loading ? 'Connecting...' : 'Sign in with Microsoft'}
        </button>
      </div>
    </div>
  );
}
