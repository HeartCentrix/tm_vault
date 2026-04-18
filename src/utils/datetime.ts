// Backend often returns naive ISO strings (e.g. Python datetime.isoformat()
// on a naive UTC value: "2026-04-17T18:24:57.797"). JS's Date parses those
// as local time, which shifts everything by the user's UTC offset. Treat any
// string without an explicit timezone suffix (Z or ±HH:MM) as UTC so the
// browser can then convert to local for display.
export function parseAsUtc(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  let s = String(value).trim();
  const hasTime = /T\d{2}:\d{2}/.test(s);
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  if (hasTime && !hasTz) s = s + 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtLocal(value: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = parseAsUtc(value);
  if (!d) return '';
  return d.toLocaleString('en-US', opts);
}

export function fmtLocalDate(value: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = parseAsUtc(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', opts);
}

export function fmtLocalTime(value: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = parseAsUtc(value);
  if (!d) return '';
  return d.toLocaleTimeString('en-US', opts);
}
