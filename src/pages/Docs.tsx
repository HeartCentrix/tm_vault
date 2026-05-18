import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './Docs.css';
import { DOCS_SECTIONS, type DocSection } from './docs/content.tsx';

type FlatNode = {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
};

function flatten(sections: DocSection[], parentId: string | null = null): FlatNode[] {
  const out: FlatNode[] = [];
  for (const s of sections) {
    out.push({ id: s.id, title: s.title, level: s.level, parentId });
    if (s.children?.length) out.push(...flatten(s.children, s.id));
  }
  return out;
}

export default function Docs() {
  const nav = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const allNodes = useMemo(() => flatten(DOCS_SECTIONS), []);

  // Filtered side index — empty query shows full tree, otherwise matches by title.
  const filtered = useMemo(() => {
    if (!query.trim()) return allNodes;
    const q = query.trim().toLowerCase();
    return allNodes.filter(n => n.title.toLowerCase().includes(q));
  }, [allNodes, query]);

  // Scroll-spy: track which heading is visible at the top of the viewport.
  useEffect(() => {
    const opts: IntersectionObserverInit = {
      root: contentRef.current,
      rootMargin: '-72px 0px -70% 0px',
      threshold: [0, 1],
    };
    const seen = new Map<string, IntersectionObserverEntry>();
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e);
      // Pick the topmost intersecting heading.
      const visible = [...seen.values()]
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, opts);
    const root = contentRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-doc-anchor]').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Initial scroll to the hash anchor if present.
  useEffect(() => {
    const hash = location.hash?.replace('#', '');
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'auto' }));
      setActiveId(hash);
    }
  }, [location.hash]);

  const goAnchor = (id: string) => {
    nav(`/docs#${id}`, { replace: false });
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="docs-page">
      <aside className="docs-sidebar">
        <div className="docs-sidebar__header">
          <div className="docs-sidebar__title">TMvault Docs</div>
          <div className="docs-sidebar__sub">Engineering reference</div>
        </div>
        <div className="docs-sidebar__search">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter sections…"
            aria-label="Filter docs sections"
          />
        </div>
        <nav className="docs-sidebar__nav" aria-label="Docs navigation">
          {filtered.map(n => (
            <button
              key={n.id}
              className={`docs-sidebar__item docs-sidebar__item--l${n.level} ${activeId === n.id ? 'is-active' : ''}`}
              onClick={() => goAnchor(n.id)}
              title={n.title}
            >
              {n.title}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="docs-sidebar__empty">No section matches “{query}”.</div>
          )}
        </nav>
      </aside>

      <main className="docs-content" ref={contentRef}>
        <div className="docs-content__inner">
          {DOCS_SECTIONS.map(s => renderSection(s))}
        </div>
      </main>
    </div>
  );
}

function renderSection(s: DocSection) {
  const Heading: 'h1' | 'h2' | 'h3' | 'h4' = (s.level === 1
    ? 'h1'
    : s.level === 2
      ? 'h2'
      : s.level === 3
        ? 'h3'
        : 'h4');
  return (
    <section
      key={s.id}
      className={`docs-section docs-section--l${s.level}`}
    >
      <Heading
        id={s.id}
        data-doc-anchor=""
        className="docs-section__heading"
      >
        <a className="docs-section__anchor" href={`#${s.id}`} aria-label="Anchor link">
          #
        </a>
        {s.title}
      </Heading>
      {s.content && <div className="docs-section__body">{s.content}</div>}
      {s.children?.map(c => renderSection(c))}
    </section>
  );
}
