import { Link, useLocation } from 'react-router-dom';

/**
 * Catch-all route.
 *
 * Before this existed, any unmatched path — `/service`, a stale bookmark, a
 * typo — rendered a completely blank white document: no header, no sidebar,
 * no error, just a `No routes matched location "/service"` warning in the
 * console. The only escape was editing the address bar. A blank page is never
 * an acceptable terminal state (BUG-007).
 *
 * Rendered inside <Layout>, so the app shell (sidebar + header) stays up and
 * the user can simply click somewhere else.
 */
export default function NotFound() {
  const location = useLocation();
  return (
    <div className="not-found-page" style={{ padding: '48px 32px', maxWidth: 640 }}>
      <h2 className="page-title">Page not found</h2>
      <p style={{ marginTop: 12, opacity: 0.8 }}>
        Nothing is registered at <code>{location.pathname}</code>.
      </p>
      <p style={{ marginTop: 24 }}>
        <Link to="/activity">Go to Activity &amp; Audit</Link>
      </p>
    </div>
  );
}
