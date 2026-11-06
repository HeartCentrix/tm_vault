// Shared presentation helpers.
//
// Every one of these exists because the same formatting was open-coded at
// a dozen call sites and drifted. Import from here rather than re-deriving
// initials / thousands separators / label prettifying inline.

const NUMBER_FORMAT = new Intl.NumberFormat();

/**
 * Locale-aware thousands separators for every user-visible integer.
 *
 * 2026-08-11 (TMV-028): the Recovery mail footer rendered `Showing 50 of
 * 46008` while the tab badge directly above it rendered `46,008` — the
 * badge used `.toLocaleString()` and the footer interpolated the raw
 * number. One formatter, one answer.
 *
 * Non-finite input renders as an em dash rather than "NaN".
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return NUMBER_FORMAT.format(value);
}

/**
 * Avatar initials, letters/digits only.
 *
 * 2026-08-11 (TMV-026): the old implementation was
 * `name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)`,
 * which takes the FIRST CHARACTER of each space-delimited token whatever
 * that character is. Observed in production:
 *   "(unnamed)"                          -> "("
 *   "Tanium – Software – Adobe Acrobat"  -> "T–"   (en dash, U+2013)
 *   "Chaparral – Large Conference Room"  -> "C–"
 * Punctuation is stripped from each token before the initial is taken, so
 * those become "" (caller renders a neutral icon), "TS" and "CL".
 *
 * Returns '' when the name carries no letter or digit at all — callers
 * must fall back to an icon (see `AvatarInitials`), never to punctuation.
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '';
  return String(name)
    .split(/\s+/)
    // \p{L}\p{N} keeps accented latin, CJK and digits; drops dashes,
    // parentheses, quotes, bullets and the en/em dashes above.
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/**
 * Turn a backend enum / snake_case token into a readable label.
 *
 * 2026-08-11 (TMV-027): resource rows printed the raw `kind` with only
 * underscores swapped for spaces, so the subtitle under a room mailbox
 * read "room mailbox" and under a service principal "entra service
 * principal". Capitalise, and special-case the acronyms the product uses
 * so we don't ship "Sql database" / "Entra id".
 */
const LABEL_ACRONYMS: Record<string, string> = {
  id: 'ID',
  sql: 'SQL',
  vm: 'VM',
  bi: 'BI',
  dlp: 'DLP',
  m365: 'M365',
  todo: 'To Do',
  onedrive: 'OneDrive',
  onenote: 'OneNote',
  sharepoint: 'SharePoint',
  postgresql: 'PostgreSQL',
  entra: 'Entra',
  intune: 'Intune',
  bitlocker: 'BitLocker',
};

export function prettifyEnumLabel(value: string | null | undefined): string {
  if (!value) return '';
  const words = String(value).trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (LABEL_ACRONYMS[lower]) return LABEL_ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Strip storage-path plumbing from a name before showing it to a user.
 *
 * 2026-08-11 (TMV-027): chat threads rendered as `chats/!!Certificate
 * Renewal Planning!!`, mail folders as `/Inbox` and `/Deleted Items`, and
 * one folder as the raw Graph id `folder:AAMkAGQ4OTc2…`. The first two are
 * storage prefixes; the third is an id we cannot resolve here, so it
 * becomes a neutral placeholder instead of 100 characters of base64.
 *
 * Shared so the Recovery views can adopt it without re-deriving the regex.
 */
export function cleanDisplayPath(value: string | null | undefined, fallback = 'Unknown'): string {
  if (!value) return fallback;
  let s = String(value).trim();
  // Unresolvable Graph ids — never print these.
  if (/^(folder|item|drive|site|user|group):[A-Za-z0-9+/=_-]{12,}$/.test(s)) return fallback;
  s = s.replace(/^(chats|mail|folders|contacts|calendar|onedrive)\//i, '');
  s = s.replace(/^\/+/, '');
  return s.trim() || fallback;
}
