import { useNavigate } from 'react-router-dom';
import './Auth.css';

export default function Signup() {
  const navigate = useNavigate();

  const handleSSO = (provider: string) => {
    // For now, bypass auth and go to tenants
    navigate('/tenants');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <svg className="auth-logo-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="m 307,458.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'#0d9488', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 323,455.01367 a 1,1 0 0 0 -0.0508,0.006 1.0001,1.0001 0 0 0 -0.11914,0.0137 1,1 0 0 0 -0.10547,0.0254 1.0001,1.0001 0 0 0 -0.10352,0.0352 1,1 0 0 0 -0.10547,0.0508 1.0001,1.0001 0 0 0 -0.0898,0.0566 1,1 0 0 0 -0.0859,0.0684 1.0001,1.0001 0 0 0 -0.0469,0.0371 l -2,2 a 1,1 0 0 0 0,1.41406 1,1 0 0 0 1.41406,0 L 322,458.42773 v 3.58594 a 1,1 0 0 0 1,1 1,1 0 0 0 1,-1 v -3.58594 l 0.29297,0.29297 a 1,1 0 0 0 1.41406,0 1,1 0 0 0 0,-1.41406 l -1.9707,-1.9707 a 1,1 0 0 0 -0.40625,-0.26563 1.0001,1.0001 0 0 0 -0.002,0 1.0001,1.0001 0 0 0 -0.004,-0.002 1,1 0 0 0 -0.19922,-0.0449 1.0001,1.0001 0 0 0 -0.0273,-0.004 1,1 0 0 0 -0.0977,-0.006 z" style={{fill:'#0d9488', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 307,450.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'#0d9488', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 307,442.01367 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 4 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z" style={{fill:'#0d9488', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
            <path d="m 305,438.01367 c -1.6447,0 -3,1.3553 -3,3 v 4 c 0,0.76628 0.29675,1.46716 0.77734,2 -0.48059,0.53284 -0.77734,1.23372 -0.77734,2 v 4 c 0,0.76628 0.29675,1.46716 0.77734,2 -0.48059,0.53284 -0.77734,1.23372 -0.77734,2 v 4 c 0,1.6447 1.3553,3 3,3 h 13.11133 c 1.26351,1.23579 2.98973,2 4.88867,2 3.85414,0 7,-3.14585 7,-7 0,-2.78161 -1.63913,-5.19487 -4,-6.32226 v -3.67774 c 0,-0.76628 -0.29675,-1.46716 -0.77734,-2 0.48059,-0.53284 0.77734,-1.23372 0.77734,-2 v -4 c 0,-1.6447 -1.3553,-3 -3,-3 z m 0,2 h 18 c 0.5713,0 1,0.42871 1,1 v 4 c 0,0.5713 -0.4287,1 -1,1 h -18 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z m 0,8 h 18 c 0.5713,0 1,0.42871 1,1 v 3.07227 c -0.32711,-0.0472 -0.66021,-0.0723 -1,-0.0723 -1.89894,0 -3.62516,0.76421 -4.88867,2 H 305 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z m 18,6 c 2.77327,0 5,2.22674 5,5 0,2.77327 -2.22673,5 -5,5 -1.44074,0 -2.73243,-0.602 -3.64258,-1.56836 a 1,1 0 0 0 -0.16797,-0.18554 C 318.44728,461.38795 318,460.25556 318,459.01367 c 0,-1.25636 0.45901,-2.39958 1.2168,-3.27539 a 1,1 0 0 0 0.0645,-0.0762 c 0.91337,-1.01394 2.23794,-1.64844 3.71875,-1.64844 z m -18,2 h 11.67773 c -0.43469,0.9103 -0.67773,1.92747 -0.67773,3 0,1.07253 0.24304,2.0897 0.67773,3 H 305 c -0.5713,0 -1,-0.4287 -1,-1 v -4 c 0,-0.57129 0.4287,-1 1,-1 z" style={{fill:'#0d9488', fillRule:'evenodd', strokeLinecap:'round', strokeLinejoin:'round', strokeMiterlimit:4.1}} transform="translate(-300,-436)"/>
          </svg>
          <h1 className="auth-title">TM.vault</h1>
        </div>

        <p className="auth-subtitle">Create your account</p>

        <div className="sso-options">
          <button className="sso-option-btn" onClick={() => handleSSO('google')}>
            <svg viewBox="0 0 24 24" style={{width: 20, height: 20}}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <button className="sso-option-btn" onClick={() => handleSSO('microsoft')}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{width: 20, height: 20}}>
              <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
              <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
              <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
              <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
            </svg>
            Continue with Microsoft
          </button>

          <button className="sso-option-btn" onClick={() => handleSSO('okta')}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{width: 20, height: 20, color: '#007DC1'}}>
              <circle cx="12" cy="12" r="10"/>
            </svg>
            Continue with Okta
          </button>

          <button className="sso-option-btn" onClick={() => handleSSO('saml')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 20, height: 20}}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Continue with SAML SSO
          </button>
        </div>
      </div>
    </div>
  );
}
