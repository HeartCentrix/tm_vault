import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityRow } from './ActivityRow';
import type { ActivityItem } from '../services/activity';

const item: ActivityItem = {
  id: 'job-a', jobIds: ['job-a'], operation: 'BACKUP', object: 'Mailbox',
  start_time: '2026-11-02T00:00:00', finish_time: '', status: 'Done', details: 'Completed',
};

const render = (row: ActivityItem) => renderToStaticMarkup(
  <table><tbody><ActivityRow
    item={row} displayedProgressPct={100} formatDate={value => value}
    renderStatusIcon={status => <span data-status={status}>{status}</span>}
  /></tbody></table>,
);

describe('Activity copy progress', () => {
  it('preserves legacy rows and completed copy summaries', () => {
    expect(render({ ...item, copy_work: null })).toBe(render(item));
    expect(render({ ...item, copy_work: { state: 'COMPLETE', committed_rows: 12 } })).toBe(render(item));
  });

  it.each([
    ['CAPTURING', 'Capturing backup data'],
    ['QUEUED', 'Waiting for backup processing capacity'],
    ['RUNNING', 'Preparing backup records'],
    ['WAITING_RESUME', 'Finalizing backup'],
  ])('shows %s without presenting premature completion', (state, label) => {
    const row = { ...item, copy_work: { state, pending_tasks: 1, committed_rows: 12 } };
    const html = render(row);
    expect(html).toContain(label);
    expect(html).toContain('12 records prepared');
    expect(html).toContain('data-status="In Progress"');
    expect(html).not.toContain('100%');
    expect(row.status).toBe('Done');
  });

  it('shows partial capture when required copy failed after useful content was captured', () => {
    const row = { ...item, copy_work: { state: 'FAILED', committed_rows: 12, failed_tasks: 1 } };
    const html = render(row);
    expect(html).toContain('data-status="Partial"');
    expect(html).toContain('Backup records are incomplete');
    expect(html).not.toContain('data-status="Done"');
    expect(row.status).toBe('Done');
  });

  it('recognizes capture outside the copy task counters', () => {
    expect(render({ ...item, bytesDone: 64, copy_work: { state: 'FAILED', committed_rows: 0 } }))
      .toContain('data-status="Partial"');
  });

  it('shows failure when no useful content was captured', () => {
    expect(render({ ...item, copy_work: { state: 'FAILED', committed_rows: 0 } }))
      .toContain('data-status="Failed"');
  });

  it('preserves an existing partial capture when copy counters are empty', () => {
    expect(render({ ...item, status: 'Partial', copy_work: { state: 'FAILED', committed_rows: 0 } }))
      .toContain('data-status="Partial"');
  });

  it('preserves cancellation and omits technical summary details', () => {
    const html = render({ ...item, status: 'Canceled', copy_work: {
      state: 'FAILED', committed_rows: 1, gap_counts: { private_query_or_identifier: 1 },
    } });
    expect(html).toContain('data-status="Canceled"');
    expect(html).not.toContain('private_query_or_identifier');
  });
});

describe('Activity provider progress', () => {
  it.each([
    ['WAITING', 'Waiting for Microsoft; backup will resume automatically'],
    ['RUNNING', 'Capturing backup data'],
    ['SETTLING', 'Finalizing backup'],
  ])('keeps %s provider work active without changing captured bytes', (state, label) => {
    const row = { ...item, bytesDone: 4096, provider_work: { state, pending_leaves: 1 } };
    const html = render(row);
    expect(html).toContain(label);
    expect(html).toContain('data-status="In Progress"');
    expect(html).not.toContain('100%');
    expect(row.bytesDone).toBe(4096);
    expect(row.status).toBe('Done');
  });

  it('preserves cancellation while showing truthful failed coverage', () => {
    expect(render({ ...item, status: 'Canceled', provider_work: { state: 'WAITING' } }))
      .toContain('data-status="Canceled"');
    expect(render({ ...item, bytesDone: 1024, provider_work: { state: 'INCOMPLETE' } }))
      .toContain('data-status="Partial"');
    expect(render({ ...item, provider_work: { state: 'COMPLETE' } })).toBe(render(item));
  });
});
