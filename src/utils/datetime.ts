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
  // Date-only strings ("2026-07-13") are CALENDAR LABELS — the dashboard
  // APIs bucket them in the operator's timezone already. JS parses bare
  // YYYY-MM-DD as UTC midnight, so localizing shifted every chart label
  // back one day for any viewer west of UTC (the Overview backup-size
  // graph "ended at 7/12" while the API's last bucket was 7/13). Parse
  // as LOCAL midnight so display formatting keeps the same calendar day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (dateOnly) {
    const [y, m, day] = s.split('-').map(Number);
    const d = new Date(y, m - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }
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
