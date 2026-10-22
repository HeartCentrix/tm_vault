import { getInitials } from '../utils/display';

interface Props {
  /** Display name to derive initials from. May be empty/punctuation-only. */
  name: string | null | undefined;
  /** Existing avatar class (`resource-avatar`, `resource-avatar-sm`, …). */
  className?: string;
  /** Extra title text; defaults to the name itself. */
  title?: string;
}

/**
 * Avatar bubble that shows letter initials, or a neutral person glyph when
 * the name has no letter or digit to take an initial from.
 *
 * 2026-08-11 (TMV-026): production rendered `(` for the "(unnamed)"
 * contact and `T–` for "Tanium – Software – Adobe Acrobat" because the
 * initial-derivation took the first character of each token verbatim.
 * getInitials() now strips punctuation, which means it can legitimately
 * return '' — this component owns that fallback so no caller re-invents
 * it. The bubble is aria-hidden: the adjacent row already carries the
 * accessible name, and "TS" read aloud is noise.
 */
export default function AvatarInitials({ name, className = 'resource-avatar', title }: Props) {
  const initials = getInitials(name);
  return (
    <div className={className} aria-hidden="true" title={title ?? (name || undefined)}>
      {initials || (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="avatar-fallback-icon"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </div>
  );
}
