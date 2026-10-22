// Status glyphs + parent rollup for the Activity batch drilldown.
// Extracted from ActivityRow.tsx so the logic is unit-testable (vitest
// can't import the component without a DOM) — behavior is unchanged
// except for NOT_IN_RUN support (see below).

export function statusGlyph(status?: string): { ch: string; cls: string; label: string } {
  switch ((status || '').toUpperCase()) {
    case 'COMPLETED':   return { ch: '✓', cls: 'glyph-done',    label: 'Completed' };
    case 'IN_PROGRESS': return { ch: '◐', cls: 'glyph-running', label: 'In progress' };
    case 'FAILED':      return { ch: '✗', cls: 'glyph-failed',  label: 'Failed' };
    case 'PARTIAL':     return { ch: '⚠', cls: 'glyph-partial', label: 'Partial' };
    case 'EXPIRED':     return { ch: '⌛', cls: 'glyph-pending', label: 'Expired' };
    case 'SKIPPED_NO_LICENSE':
                        return { ch: '⊘', cls: 'glyph-skipped', label: 'Skipped — no license' };
    // Scoped into the batch but no snapshot was ever recorded for it:
    // overlap-held, policy-excluded, or the dispatch never landed. The
    // backend stamps this explicitly on SETTLED batches only (audit-
    // service batch_children.py) so settled runs stop implying pending
    // work. '○' (empty circle) — NOT '—', which the count/bytes columns
    // already use for null data.
    case 'NOT_IN_RUN':  return { ch: '○', cls: 'glyph-na',      label: 'Not in this run' };
    default:            return { ch: '⋯', cls: 'glyph-pending', label: 'Pending' };
  }
}

// Roll up a parent's status from its children. The backend's parent row
// is the Tier-1 ENTRA_USER snapshot, which COMPLETES as soon as the
// user-metadata fetch finishes — long before per-workload Tier-2
// snapshots (Mail / OneDrive / Chats / Calendar / Contacts) settle. If
// we surface the raw parent.status, the operator sees a ✓ next to the
// user name while every workload row still shows ⋯ — the original
// 2026-05-16 UX complaint. Aggregate so the parent glyph reflects the
// WHOLE user.
//   - NOT_IN_RUN children are skipped: they never participated in this
//     batch (unlicensed, held, policy-excluded) and must not drag a
//     settled run's glyph to "in progress" — the perpetual-◐ artifact
//     (2026-08-26, Corp_Esplanade's unlicensed OneDrive).
//   - any child PENDING / IN_PROGRESS / unknown  → IN_PROGRESS
//   - all children COMPLETED                     → COMPLETED
//   - all children FAILED                        → FAILED
//   - mix of COMPLETED + FAILED/PARTIAL          → PARTIAL
export function rollupParentStatus(
  parentStatus: string | undefined,
  kids: { status?: string }[],
): string {
  const participating = kids.filter(
    (k) => (k.status || '').toUpperCase() !== 'NOT_IN_RUN',
  );
  if (!participating.length) return (parentStatus || '').toUpperCase();
  let anyPending = false, anyCompleted = false, anyFailed = false, anyPartial = false;
  for (const k of participating) {
    const s = (k.status || '').toUpperCase();
    if (s === 'COMPLETED') anyCompleted = true;
    else if (s === 'FAILED') anyFailed = true;
    else if (s === 'PARTIAL') anyPartial = true;
    else if (s === 'SKIPPED_NO_LICENSE') continue;
    else anyPending = true; // IN_PROGRESS, PENDING, unknown
  }
  if (anyPending) return 'IN_PROGRESS';
  if (anyFailed && !anyCompleted && !anyPartial) return 'FAILED';
  if (anyFailed || anyPartial) return 'PARTIAL';
  return 'COMPLETED';
}
