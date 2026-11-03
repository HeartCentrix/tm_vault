import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackupSizeFreshness, sizeHeadline, sizeNeedsRefresh, sizeProjectionAllowed } from './BackupSizeFreshness';

describe('backup size freshness', () => {
  it('shows calculating rather than zero when no baseline exists', () => {
    const data = { totalBytes: null, missingCount: 2, partial: true, freshness: 'missing' };
    expect(sizeHeadline(data)).toBe('Calculating…');
    expect(sizeNeedsRefresh(data)).toBe(true);
    expect(renderToStaticMarkup(<BackupSizeFreshness stats={data} />)).toContain('Calculating backup size');
  });

  it('retains known totals while missing and stale resources catch up', () => {
    const data = { total: '2.40 TB', totalBytes: 2400, freshCount: 100, staleCount: 8,
      missingCount: 2, eligibleCount: 110, partial: true, stale: true, freshness: 'missing' };
    expect(sizeHeadline(data)).toBe('2.40 TB');
    const html = renderToStaticMarkup(<BackupSizeFreshness stats={data} />);
    expect(html).toContain('Partial last-known total');
    expect(html).toContain('100 of 110 resources up to date');
    expect(html).not.toContain('lower bound');
    expect(sizeProjectionAllowed(data)).toBe(false);
  });

  it('stale complete coverage stays visible with update age', () => {
    const data = { total: '100 MB', totalBytes: 100, stale: true, freshness: 'stale',
      asOf: '2026-11-02T03:00:00Z' };
    const html = renderToStaticMarkup(<BackupSizeFreshness stats={data} />);
    expect(html).toContain('Updating backup size');
    expect(html).toContain('<time');
    expect(sizeNeedsRefresh(data)).toBe(true);
    expect(sizeHeadline(data)).toBe('100 MB');
  });

  it('never projects incomplete history or an initializing baseline', () => {
    expect(sizeProjectionAllowed({ totalBytes: 100, freshness: 'fresh', historyPartial: true })).toBe(false);
    expect(sizeProjectionAllowed({ totalBytes: 100, freshness: 'fresh', initializingScope: true })).toBe(false);
    expect(sizeProjectionAllowed({ totalBytes: null, freshness: 'fresh' })).toBe(false);
    expect(sizeProjectionAllowed({ totalBytes: 0, freshness: 'fresh', partial: false })).toBe(true);
  });

  it('preserves older complete responses and flags older partial ones', () => {
    expect(sizeHeadline({ total: '5 GB' })).toBe('5 GB');
    expect(sizeNeedsRefresh({ total: '5 GB' })).toBe(false);
    expect(sizeProjectionAllowed({ totalBytes: 5 })).toBe(true);
    expect(sizeProjectionAllowed({ totalBytes: 5, partial: true })).toBe(false);
  });

  it('does not expose an invalid update timestamp or claim absent data is zero', () => {
    expect(renderToStaticMarkup(<BackupSizeFreshness stats={{ asOf: 'invalid', freshness: 'missing' }} />)).not.toContain('<time');
    expect(sizeHeadline({})).toBe('Calculating…');
  });

  it('does not date a calculation when there is no published value', () => {
    const html = renderToStaticMarkup(<BackupSizeFreshness stats={{
      totalBytes: null, freshness: 'missing', asOf: '2026-11-02T03:00:00Z',
    }} />);
    expect(html).not.toContain('<time');
  });
});
