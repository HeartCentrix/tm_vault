import { describe, it, expect } from 'vitest';
import { apiError } from './resource';

// The banner on the Protection page renders apiError's message verbatim,
// so every shape the backend can return must come out as prose — never a
// JSON.stringify'd blob (the deployed backend 422s EVERY filter-path
// request with a Pydantic error array until the filter-capable backend
// ships, so the array case is the common one in prod today).

const jsonResponse = (status: number, statusText: string, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });

describe('apiError', () => {
  it('surfaces a string detail verbatim (FastAPI HTTPException)', async () => {
    const err = await apiError(
      jsonResponse(403, 'Forbidden', { detail: 'Administrator role required' }),
      'Failed to bulk assign policy',
    );
    expect(err.message).toBe('Administrator role required');
  });

  it('renders a FastAPI 422 validation array as field: message lines, not JSON', async () => {
    const err = await apiError(
      jsonResponse(422, 'Unprocessable Entity', {
        detail: [
          { loc: ['body', 'resourceIds'], msg: 'Field required', type: 'missing' },
          { loc: ['body', 'policyId'], msg: 'Input should be a valid string', type: 'string_type' },
        ],
      }),
      'Failed to bulk assign policy',
    );
    expect(err.message).toBe(
      'resourceIds: Field required; policyId: Input should be a valid string',
    );
    expect(err.message).not.toContain('{');
    expect(err.message).not.toContain('[');
  });

  it('drops non-string loc parts (array indices) and tolerates malformed entries', async () => {
    const err = await apiError(
      jsonResponse(422, 'Unprocessable Entity', {
        detail: [
          { loc: ['body', 'filter', 'types', 0], msg: 'Invalid resource type' },
          { nonsense: true },
          { msg: 'Standalone message' },
        ],
      }),
      'Failed to bulk assign policy',
    );
    expect(err.message).toBe('filter.types: Invalid resource type; Standalone message');
  });

  it('falls back to status line for a non-string, non-array detail instead of stringifying it', async () => {
    const err = await apiError(
      jsonResponse(500, 'Internal Server Error', { detail: { code: 'X', nested: [1, 2] } }),
      'Failed to bulk assign policy',
    );
    expect(err.message).toBe('Failed to bulk assign policy: 500 Internal Server Error');
  });

  it('falls back to status line when the body is not JSON', async () => {
    const res = new Response('<html>gateway timeout</html>', { status: 504, statusText: 'Gateway Timeout' });
    const err = await apiError(res, 'Failed to bulk assign policy');
    expect(err.message).toBe('Failed to bulk assign policy: 504 Gateway Timeout');
  });

  it('falls back to status line when detail is an array yielding no messages', async () => {
    const err = await apiError(
      jsonResponse(422, 'Unprocessable Entity', { detail: [] }),
      'Failed to bulk assign policy',
    );
    expect(err.message).toBe('Failed to bulk assign policy: 422 Unprocessable Entity');
  });
});
