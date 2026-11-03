import { describe, it, expect } from 'vitest';
import { statusGlyph, rollupParentStatus } from './activityGlyphs';

// Pins the fix for the perpetual "◐ In progress" artifact (2026-08-26,
// Corp_Esplanade): a NOT_IN_RUN child (unlicensed / overlap-held /
// policy-excluded — stamped by audit-service batch_children.py) must not
// drag a settled run's parent glyph to "in progress".

const kid = (status?: string) => ({ status });

describe('statusGlyph', () => {
  it('maps NOT_IN_RUN to a neutral glyph, not pending', () => {
    expect(statusGlyph('NOT_IN_RUN')).toEqual({
      ch: '○', cls: 'glyph-na', label: 'Not in this run',
    });
    // '—' is what the count/bytes columns render for null data — the
    // status glyph must not be confusable with missing data.
    expect(statusGlyph('NOT_IN_RUN').ch).not.toBe('—');
  });

  it('keeps local expired and license-skipped labels', () => {
    expect(statusGlyph('EXPIRED').label).toBe('Expired');
    expect(statusGlyph('SKIPPED_NO_LICENSE')).toEqual({
      ch: '⊘', cls: 'glyph-skipped', label: 'Skipped — no license',
    });
  });

  it('keeps the existing map intact', () => {
    expect(statusGlyph('COMPLETED').ch).toBe('✓');
    expect(statusGlyph('IN_PROGRESS').ch).toBe('◐');
    expect(statusGlyph('FAILED').ch).toBe('✗');
    expect(statusGlyph('PARTIAL').ch).toBe('⚠');
    // Missing status stays "pending" — defensive for live runs served by
    // an older backend that omits the status key for queued children.
    expect(statusGlyph(undefined).label).toBe('Pending');
    expect(statusGlyph('').label).toBe('Pending');
  });
});

describe('rollupParentStatus', () => {
  it('Corp_Esplanade case: all-completed + NOT_IN_RUN child → COMPLETED', () => {
    const kids = [
      kid('COMPLETED'), kid('COMPLETED'), kid('COMPLETED'),
      kid('COMPLETED'), kid('COMPLETED'), kid('COMPLETED'),
      kid('NOT_IN_RUN'), // the unlicensed OneDrive
    ];
    expect(rollupParentStatus('COMPLETED', kids)).toBe('COMPLETED');
  });

  it('Jason Rue case unchanged: completed + PARTIAL archive → PARTIAL', () => {
    const kids = [
      kid('COMPLETED'), kid('COMPLETED'), kid('COMPLETED'),
      kid('COMPLETED'), kid('COMPLETED'), kid('COMPLETED'),
      kid('PARTIAL'), // the archive
    ];
    expect(rollupParentStatus('COMPLETED', kids)).toBe('PARTIAL');
  });

  it('handles license-skipped children alongside customer NOT_IN_RUN statuses', () => {
    expect(rollupParentStatus('COMPLETED', [
      kid('COMPLETED'), kid('SKIPPED_NO_LICENSE'), kid('NOT_IN_RUN'),
    ])).toBe('COMPLETED');
    expect(rollupParentStatus('COMPLETED', [
      kid('FAILED'), kid('SKIPPED_NO_LICENSE'), kid('NOT_IN_RUN'),
    ])).toBe('FAILED');
    expect(rollupParentStatus('COMPLETED', [
      kid('IN_PROGRESS'), kid('SKIPPED_NO_LICENSE'), kid('NOT_IN_RUN'),
    ])).toBe('IN_PROGRESS');
  });

  it('NOT_IN_RUN does not mask a real in-progress child', () => {
    expect(rollupParentStatus('COMPLETED', [
      kid('NOT_IN_RUN'), kid('IN_PROGRESS'), kid('COMPLETED'),
    ])).toBe('IN_PROGRESS');
  });

  it('missing status still counts as pending (old-backend safety)', () => {
    expect(rollupParentStatus('COMPLETED', [
      kid('COMPLETED'), kid(undefined),
    ])).toBe('IN_PROGRESS');
  });

  it('all children NOT_IN_RUN → falls back to the parent status', () => {
    expect(rollupParentStatus('COMPLETED', [
      kid('NOT_IN_RUN'), kid('NOT_IN_RUN'),
    ])).toBe('COMPLETED');
    // and an undefined parent stays a non-status (renders ⋯)
    expect(rollupParentStatus(undefined, [kid('NOT_IN_RUN')])).toBe('');
  });

  it('no children → raw parent status (pre-existing behavior)', () => {
    expect(rollupParentStatus('completed', [])).toBe('COMPLETED');
    expect(rollupParentStatus(undefined, [])).toBe('');
  });

  it('failure rollups unchanged', () => {
    expect(rollupParentStatus('X', [kid('FAILED'), kid('FAILED')])).toBe('FAILED');
    expect(rollupParentStatus('X', [kid('FAILED'), kid('COMPLETED')])).toBe('PARTIAL');
    expect(rollupParentStatus('X', [kid('FAILED'), kid('NOT_IN_RUN')])).toBe('FAILED');
  });
});
