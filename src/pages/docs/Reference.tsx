/**
 * Reference renderer — fetches one of the bundled docs-reference/*.md
 * files (served from /public/docs-reference/) and renders the result.
 *
 * The bundled files are pre-built by parallel extraction agents at
 * build time; they're the most exhaustive grounded reference. We
 * fetch them at runtime to keep the JS bundle small.
 */
import { useEffect, useState } from 'react';
import { mdToHtml } from './markdown';

type Props = {
  /** path relative to /docs-reference/ — e.g. "envvars.md" */
  file: string;
};

export function Reference({ file }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    setHtml(null);
    setError(null);
    fetch(`/docs-reference/${file}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(md => { if (!abort) setHtml(mdToHtml(md)); })
      .catch(e => { if (!abort) setError(String(e)); });
    return () => { abort = true; };
  }, [file]);

  if (error) {
    return <p style={{ color: '#A33', fontStyle: 'italic' }}>Failed to load reference: {error}</p>;
  }
  if (html === null) {
    return <p style={{ color: '#8A8275', fontStyle: 'italic' }}>Loading reference…</p>;
  }
  return <div className="docs-reference" dangerouslySetInnerHTML={{ __html: html }} />;
}
