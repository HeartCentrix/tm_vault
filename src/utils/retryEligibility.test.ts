import { describe, it, expect } from 'vitest';
import {
  shouldShowRetry,
  collectIncompleteResourceIds,
  RETRY_DISPATCH_LIMIT,
  type RetryEligibleItem,
  type ActivityStatus,
} from './retryEligibility';

// NB `batchId` is passed through verbatim — do NOT give it a default, or
// `row(..., undefined)` silently becomes a batched row and the
// "no batch" cases pass vacuously.
const row = (
  status: ActivityStatus,
  counts?: Partial<NonNullable<RetryEligibleItem['counts']>>,
  batchId?: string,
): RetryEligibleItem => ({
  status,
  batchId,
  counts: counts
    ? { total: 0, done: 0, partial: 0, failed: 0, in_progress: 0, queued: 0, ...counts }
    : undefined,
});

describe('shouldShowRetry', () => {
  it('hides on a fully clean run — the whole point of the feature', () => {
    expect(shouldShowRetry(row('Done', undefined, 'b1'))).toBe(false);
    expect(shouldShowRetry(row('Done', { total: 50, done: 50 }, 'b1'))).toBe(false);
  });

  it('does not retry a successful restore point that aged out', () => {
    expect(shouldShowRetry(row('Expired', undefined, 'b1'))).toBe(false);
  });

  it('shows when the run did not fully complete', () => {
    expect(shouldShowRetry(row('Failed', undefined, 'b1'))).toBe(true);
    expect(shouldShowRetry(row('Partial', undefined, 'b1'))).toBe(true);
    expect(shouldShowRetry(row('Warning', undefined, 'b1'))).toBe(true);
    expect(shouldShowRetry(row('Canceled', undefined, 'b1'))).toBe(true);
  });

  it('never shows while the run is still going', () => {
    // That slot holds Cancel, and "retry" on unfinished work invites a
    // duplicate dispatch.
    expect(shouldShowRetry(row('In Progress', undefined, 'b1'))).toBe(false);
    expect(shouldShowRetry(row('In Progress', { partial: 3, failed: 1 }, 'b1'))).toBe(false);
  });

  it('shows on a Done row that still carries degraded children', () => {
    // The 18:12 shape: rolls up Done, but children were PARTIAL.
    expect(shouldShowRetry(row('Done', { total: 50, done: 46, partial: 4 }, 'b1'))).toBe(true);
    expect(shouldShowRetry(row('Done', { total: 50, done: 49, failed: 1 }, 'b1'))).toBe(true);
  });

  it('hides when there is no batch to enumerate', () => {
    // No children to target — retrying would be a guess.
    expect(shouldShowRetry(row('Failed', undefined, undefined))).toBe(false);
    expect(shouldShowRetry(row('Partial', { partial: 2 }, undefined))).toBe(false);
  });
});

describe('collectIncompleteResourceIds', () => {
  it('returns nothing when every child completed', () => {
    expect(collectIncompleteResourceIds([
      { resourceId: 'a', status: 'COMPLETED' },
      { resourceId: 'b', status: 'COMPLETED' },
    ])).toEqual([]);
  });

  it('picks out PARTIAL and FAILED only', () => {
    expect(collectIncompleteResourceIds([
      { resourceId: 'a', status: 'COMPLETED' },
      { resourceId: 'b', status: 'PARTIAL' },
      { resourceId: 'c', status: 'FAILED' },
    ])).toEqual(['b', 'c']);
  });

  it('EXCLUDES IN_PROGRESS — retrying a live resource yields a fake-green placeholder', () => {
    // Dispatching a resource that still holds a lease makes the scheduler
    // write a skipped_concurrent snapshot: COMPLETED with 0 items.
    expect(collectIncompleteResourceIds([
      { resourceId: 'live', status: 'IN_PROGRESS' },
      { resourceId: 'bad', status: 'FAILED' },
    ])).toEqual(['bad']);
  });

  it('walks nested Tier-2 children', () => {
    expect(collectIncompleteResourceIds([
      {
        resourceId: 'user1',
        status: 'COMPLETED',
        children: [
          { resourceId: 'chats1', status: 'PARTIAL' },
          { resourceId: 'mail1', status: 'COMPLETED' },
        ],
      },
    ])).toEqual(['chats1']);
  });

  it('returns a parent AND its incomplete children when both are degraded', () => {
    expect(collectIncompleteResourceIds([
      {
        resourceId: 'user1',
        status: 'PARTIAL',
        children: [{ resourceId: 'chats1', status: 'FAILED' }],
      },
    ])).toEqual(['user1', 'chats1']);
  });

  it('de-duplicates and preserves on-screen order', () => {
    expect(collectIncompleteResourceIds([
      { resourceId: 'x', status: 'FAILED' },
      { resourceId: 'y', status: 'PARTIAL' },
      { resourceId: 'x', status: 'PARTIAL' },
    ])).toEqual(['x', 'y']);
  });

  it('is case-insensitive about status', () => {
    expect(collectIncompleteResourceIds([
      { resourceId: 'a', status: 'partial' },
    ])).toEqual(['a']);
  });

  it('tolerates empty, undefined, and status-less nodes', () => {
    expect(collectIncompleteResourceIds(undefined)).toEqual([]);
    expect(collectIncompleteResourceIds([])).toEqual([]);
    expect(collectIncompleteResourceIds([{ resourceId: 'a' }])).toEqual([]);
  });
});

describe('RETRY_DISPATCH_LIMIT', () => {
  it('is small enough that one click cannot saturate the DB pool', () => {
    // 2026-08-17: an uncapped click dispatched 6 heavy resources at once,
    // drove backend connections to 262, and the Activity page itself then
    // timed out on the 120s pgbouncer wait.
    expect(RETRY_DISPATCH_LIMIT).toBeGreaterThanOrEqual(1);
    expect(RETRY_DISPATCH_LIMIT).toBeLessThanOrEqual(3);
  });

  it('caps the slice while leaving the remainder countable', () => {
    const targets = collectIncompleteResourceIds([
      { resourceId: 'a', status: 'PARTIAL' },
      { resourceId: 'b', status: 'PARTIAL' },
      { resourceId: 'c', status: 'FAILED' },
      { resourceId: 'd', status: 'FAILED' },
      { resourceId: 'e', status: 'PARTIAL' },
      { resourceId: 'f', status: 'PARTIAL' },
    ]);
    // Mirrors what retryIncompleteResources does with the target list.
    const sent = targets.slice(0, RETRY_DISPATCH_LIMIT);
    expect(sent).toHaveLength(RETRY_DISPATCH_LIMIT);
    expect(targets.length - sent.length).toBe(6 - RETRY_DISPATCH_LIMIT);
    // Order is preserved, so repeated clicks walk the list rather than
    // re-sending the same head every time once these complete.
    expect(sent[0]).toBe('a');
  });

  it('leaves no remainder when the run has fewer failures than the cap', () => {
    const targets = collectIncompleteResourceIds([
      { resourceId: 'only', status: 'FAILED' },
    ]);
    expect(targets.slice(0, RETRY_DISPATCH_LIMIT)).toEqual(['only']);
    expect(targets.length - Math.min(targets.length, RETRY_DISPATCH_LIMIT)).toBe(0);
  });
});
