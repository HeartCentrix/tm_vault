import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActivities, type ActivityItem } from './activity';

afterEach(() => vi.unstubAllGlobals());

const row: ActivityItem = {
  id: 'batch-ten-users', batchId: 'batch-ten-users', operation: 'BACKUP',
  object: '10 users', status: 'In Progress',
  start_time: '2026-11-06T05:06:45', finish_time: '2026-11-06T06:03:10',
  data_backed_up: 4096,
  counts: { total: 50, done: 48, partial: 1, failed: 1, in_progress: 0, queued: 0 },
  warnings: { partial: 1, failed: 1 },
};

async function load(item: ActivityItem) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    items: [item], total: 42, page: 2, size: 10, has_more: true,
  }) }));
  return getActivities({ page: 2, size: 10 });
}

describe('shared activity status for Overview and Activity', () => {
  it('reports captured-but-incomplete work as Partial on both pages', async () => {
    const input = { ...row, provider_work: { state: 'INCOMPLETE', failed_units: 1 } };
    const result = await load(input);
    expect(result.items[0]).toEqual({ ...input, status: 'Partial' });
    expect(input.status).toBe('In Progress');
    expect(result).toMatchObject({ total: 42, page: 2, size: 10, has_more: true });
  });

  it('reports incomplete work without captured content as Failed', async () => {
    const result = await load({ ...row, data_backed_up: 0, counts: undefined,
      provider_work: { state: 'INCOMPLETE' } });
    expect(result.items[0].status).toBe('Failed');
  });

  it.each(['WAITING', 'RUNNING', 'SETTLING'])('keeps %s work running despite a terminal raw status', async state => {
    const result = await load({ ...row, status: 'Done', provider_work: { state } });
    expect(result.items[0].status).toBe('In Progress');
  });

  it('keeps active copy work running while provider work reports incomplete', async () => {
    const result = await load({ ...row, status: 'Done', copy_work: { state: 'RUNNING' },
      provider_work: { state: 'INCOMPLETE' } });
    expect(result.items[0].status).toBe('In Progress');
  });

  it('reports failed copy work with saved records as Partial', async () => {
    const result = await load({ ...row, status: 'Done',
      copy_work: { state: 'FAILED', committed_rows: 12 } });
    expect(result.items[0].status).toBe('Partial');
  });

  it.each(['Canceled', 'Expired', 'Failed'] as const)('preserves %s', async status => {
    const result = await load({ ...row, status, provider_work: { state: 'RUNNING' },
      copy_work: { state: 'RUNNING' } });
    expect(result.items[0].status).toBe(status);
  });

  it.each(['In Progress', 'Done', 'Warning', 'Partial'] as const)('preserves legacy %s without work summaries', async status => {
    const result = await load({ ...row, status });
    expect(result.items[0].status).toBe(status);
  });
});
