import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/darkUI.css'
import App from './App.tsx'

// Bootstrap data-theme on <html> BEFORE React renders. Previously this lived
// in <Header>'s mount effect, but full-screen routes that skip the app shell
// (signin, OAuth callbacks, "Connecting data source…" loaders) never render
// Header — so [data-theme="dark"] was unset and those pages flashed/stayed
// light even when the user had dark mode on. Doing it here covers every
// route and avoids a flash-of-wrong-theme on first paint.
;(() => {
  try {
    const saved = localStorage.getItem('tm-theme')
    const theme = (saved === 'light' || saved === 'dark')
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', theme)
  } catch {
    // localStorage / matchMedia unavailable (e.g. SSR-like contexts) — leave
    // the attribute unset; CSS falls back to light, which is the safe default.
  }
})()

// Auth runs on an HttpOnly cookie set by the backend (so XSS can't read the
// access token from localStorage anymore). Cross-origin fetch() drops cookies
// by default — patch it once globally so every existing call site sends the
// cookie without each one having to opt in. CORS on the backend already
// allow_credentials=True with an explicit origin list, so this is safe.
const _origFetch = window.fetch.bind(window)

const _API_URL: string = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8080/api/v1'
const _REFRESH_URL = `${_API_URL}/auth/refresh`
const _SIGNIN_URL = `${_API_URL}/auth/microsoft/url`
const _LOGIN_CALLBACK_URL = `${_API_URL}/auth/callback`

// Distinguish "session is invalid" (401) from "auth-service blip" (5xx /
// network). Only the former should sign the user out. Transient failures
// keep the session alive and let the user retry their action.
type RefreshOutcome = 'ok' | 'invalid' | 'transient'

// Single-flight refresh: many concurrent 401s collapse into one /refresh.
let _refreshInFlight: Promise<RefreshOutcome> | null = null

const _emit = (name: string, detail?: any) => {
  try { window.dispatchEvent(new CustomEvent(name, { detail })) } catch { /* ignore */ }
}

const _doRefresh = (): Promise<RefreshOutcome> => {
  if (_refreshInFlight) return _refreshInFlight
  const started = performance.now()
  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const res = await _origFetch(_REFRESH_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) return 'ok'
      // 401 here = refresh token revoked / expired / missing. Sign out.
      // 5xx / 408 / 429 / network = transient; keep the session.
      if (res.status === 401) return 'invalid'
      return 'transient'
    } catch {
      return 'transient'   // network error
    }
  })()
  _refreshInFlight = promise
  promise
    .then((outcome) => {
      const latency = Math.round(performance.now() - started)
      console.info(`[auth] refresh ${outcome} in ${latency}ms`)
      _emit('tm:auth-refresh', { outcome, latency })
    })
    .finally(() => {
      // Synchronous release inside finally — no setTimeout race window.
      // Any later 401 starts a fresh flight rather than reusing a stale one.
      if (_refreshInFlight === promise) _refreshInFlight = null
    })
  return promise
}

const _redirectToSignIn = () => {
  try {
    localStorage.removeItem('user')
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  } catch { /* ignore */ }
  if (!/\/signin(\/|$|\?)/.test(window.location.pathname)) {
    window.location.assign('/signin')
  }
}

const _shouldSkipRefresh = (url: string): boolean => {
  if (url.startsWith(_REFRESH_URL)) return true
  if (url.startsWith(_SIGNIN_URL)) return true
  if (url.startsWith(_LOGIN_CALLBACK_URL)) return true
  return false
}

// Body replay safety. fetch() can take either (url, init) — fresh body each
// call — or a Request whose body is a one-shot ReadableStream. After the
// first send the stream is drained, so retrying with the same Request
// silently sends an empty body. Snapshot a clone before the first call so
// the retry has a fresh stream to consume.
const _cloneIfRequest = (input: RequestInfo | URL): RequestInfo | URL => {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return input.clone() } catch { /* fall through */ }
  }
  return input
}

window.fetch = async (input, init = {}) => {
  const reqInit: RequestInit = (init as RequestInit).credentials === undefined
    ? { credentials: 'include', ...(init as RequestInit) }
    : (init as RequestInit)

  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request)?.url ?? String(input)

  // Clone before the first send so we can retry with a fresh body stream.
  const retryInput = _cloneIfRequest(input)

  const res = await _origFetch(input as RequestInfo, reqInit)

  // Only intercept 401s on non-auth endpoints. 403 = role denied (refresh
  // doesn't help). 5xx = server problem unrelated to session.
  if (res.status !== 401 || _shouldSkipRefresh(url)) return res

  // Don't retry if the caller already gave up (route change, unmount).
  if (reqInit.signal?.aborted) return res

  const outcome = await _doRefresh()
  if (outcome === 'invalid') {
    _redirectToSignIn()
    return res
  }
  if (outcome === 'transient') {
    // Don't sign the user out on a transient auth-service blip. Bubble the
    // original 401 — the caller's existing error path handles it (toast,
    // retry button, etc.) and the next request will trigger another refresh
    // attempt.
    return res
  }

  // Refresh ok — re-check abort state, then retry with the clone.
  if (reqInit.signal?.aborted) return res
  return _origFetch(retryInput as RequestInfo, reqInit)
}

// Proactive refresh: the backend issues a non-HttpOnly companion cookie
// `access_token_expires_at` carrying the access token's expiry epoch-ms.
// We schedule a /refresh ~60s before that, so the user never sees the
// 401 + retry latency on the first request after a long idle.
const _readExpiresAt = (): number | null => {
  const m = document.cookie.match(/(?:^|;\s*)access_token_expires_at=([^;]+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

let _proactiveTimer: number | null = null
const _schedule = () => {
  if (_proactiveTimer != null) {
    clearTimeout(_proactiveTimer)
    _proactiveTimer = null
  }
  const exp = _readExpiresAt()
  if (exp == null) return
  // Refresh 60s before expiry, but never sooner than 5s from now (avoids
  // tight loops if the cookie is already past-due — the next 401 will
  // handle that path).
  const delay = Math.max(5_000, exp - Date.now() - 60_000)
  // setTimeout's max delay is ~24.8d; well above our 8h access TTL.
  _proactiveTimer = window.setTimeout(async () => {
    // Only refresh if the user is actually signed in (breadcrumb present).
    // Skips the timer if they signed out in another flow.
    if (!localStorage.getItem('user')) return
    const outcome = await _doRefresh()
    if (outcome === 'ok') _schedule()
    else if (outcome === 'invalid') _redirectToSignIn()
    // transient → fall through; the next user-driven 401 will retry
  }, delay)
}

// Re-arm the timer whenever the breadcrumb cookie changes (login, /refresh
// success, logout). Listening to focus + visibilitychange covers laptop-lid
// scenarios where setTimeout was paused while the tab slept.
window.addEventListener('tm:auth-refresh', _schedule)
window.addEventListener('focus', _schedule)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _schedule()
})
_schedule()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
