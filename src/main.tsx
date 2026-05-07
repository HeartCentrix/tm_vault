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
window.fetch = (input, init = {}) => {
  // Only default `credentials` when the caller didn't pick one explicitly.
  if ((init as RequestInit).credentials === undefined) {
    return _origFetch(input as RequestInfo, { credentials: 'include', ...(init as RequestInit) })
  }
  return _origFetch(input as RequestInfo, init as RequestInit)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
