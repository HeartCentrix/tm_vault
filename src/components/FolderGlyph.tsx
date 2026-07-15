/**
 * Outlook-style folder icons for the Recovery mailbox rail. Maps well-known
 * Exchange system folders (Inbox, Sent, Drafts, …) to recognisable glyphs and
 * falls back to a generic folder. `tab` lets Contacts fall back to a person
 * glyph instead of a folder. Decorative — the text label is always shown.
 */
type Tab = 'mail' | 'contacts' | string;

function leaf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : path).toLowerCase();
}

export function FolderGlyph({ path, tab }: { path: string; tab: Tab }) {
  const name = leaf(path);
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );

  switch (name) {
    case 'inbox':
      return svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>);
    case 'sent items':
    case 'sent':
      return svg(<><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>);
    case 'drafts':
      return svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
    case 'deleted items':
    case 'deleted':
    case 'trash':
      return svg(<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>);
    case 'junk email':
    case 'junk':
    case 'spam':
      return svg(<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>);
    case 'archive':
      return svg(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>);
    case 'outbox':
      return svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M12 2v8m0 0 3-3m-3 3L9 7" /></>);
    default:
      if (tab === 'contacts') {
        return svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>);
      }
      return svg(<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />);
  }
}
