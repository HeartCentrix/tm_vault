import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/darkUI.css'
import App from './App.tsx'

// Auth runs on an HttpOnly cookie set by the backend (so XSS can't read the
// access token from localStorage anymore). Cross-origin fetch() drops cookies
// by default — patch it once globally so every existing call site sends the
// cookie without each one having to opt in. CORS on the backend already
// allow_credentials=True with an explicit origin list, so this is safe.
const _origFetch = window.fetch.bind(window)

// Resolve the refresh URL the same way services/auth.ts does. We can't import
// it from there (cyclic — auth.ts imports config/api, which we want to keep
// dependency-free here) so derive from the same VITE_API_URL convention.
const _API_URL: string = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8080/api/v1'
const _REFRESH_URL = `${_API_URL}/auth/refresh`
const _SIGNIN_URL = `${_API_URL}/auth/microsoft/url`   // never refresh-retry these
const _LOGIN_CALLBACK_URL = `${_API_URL}/auth/callback`

// Single-flight refresh: if many requests 401 at once we want exactly one
// /auth/refresh in flight; everyone else awaits the same promise.
let _refreshInFlight: Promise<boolean> | null = null
const _doRefresh = (): Promise<boolean> => {
  if (_refreshInFlight) return _refreshInFlight
  _refreshInFlight = (async () => {
    try {
      const res = await _origFetch(_REFRESH_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      return res.ok
    } catch {
      return false
    } finally {
      // Release the lock on the next tick so any pending awaiters resolve
      // against the same outcome before a fresh refresh can start.
      setTimeout(() => { _refreshInFlight = null }, 0)
    }
  })()
  return _refreshInFlight
}

const _redirectToSignIn = () => {
  try {
    localStorage.removeItem('user')
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  } catch { /* ignore */ }
  // Avoid loop if we're already on /signin
  if (!/\/signin(\/|$|\?)/.test(window.location.pathname)) {
    window.location.assign('/signin')
  }
}

const _shouldSkipRefresh = (url: string): boolean => {
  // Don't try to refresh on auth-flow endpoints themselves — that just
  // produces nested loops or masks a real configuration error. The
  // refresh endpoint cannot be retried with itself; the login URL /
  // callback are pre-auth and will return 401 only on misconfig.
  if (url.startsWith(_REFRESH_URL)) return true
  if (url.startsWith(_SIGNIN_URL)) return true
  if (url.startsWith(_LOGIN_CALLBACK_URL)) return true
  return false
}

window.fetch = async (input, init = {}) => {
  const reqInit: RequestInit = (init as RequestInit).credentials === undefined
    ? { credentials: 'include', ...(init as RequestInit) }
    : (init as RequestInit)

  const url = typeof input === 'string'
    ? input
    : (input as Request).url ?? String(input)

  const res = await _origFetch(input as RequestInfo, reqInit)

  // Only react to 401s. 403 = role denied (refresh won't help). Skip the
  // auth endpoints themselves to avoid retry storms.
  if (res.status !== 401 || _shouldSkipRefresh(url)) return res

  const refreshed = await _doRefresh()
  if (!refreshed) {
    _redirectToSignIn()
    return res   // give the original 401 back so callers don't double-handle
  }

  // Retry the original request once. Body streams aren't replayable, so
  // requests that consumed the body before failing will still see 401 —
  // acceptable for the rare case (most app calls are GETs / JSON POSTs).
  return _origFetch(input as RequestInfo, reqInit)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
