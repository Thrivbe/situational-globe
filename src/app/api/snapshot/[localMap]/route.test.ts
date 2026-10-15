import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSnapshot, type SnapshotStore } from './handler';

const store = (value: string | null): SnapshotStore => ({
  get: async () => value === null ? null : { text: async () => value },
});

describe('snapshot route handler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns 404 for an unknown local-map id', async () => {
    const response = await handleSnapshot('nope', store('{}'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 404 when the snapshot object is missing', async () => {
    const response = await handleSnapshot('bangkok-flood', store(null));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a generic 503 when the snapshot store is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleSnapshot('bangkok-flood');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'snapshot unavailable' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a generic 503 when R2 throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing: SnapshotStore = { get: async () => { throw new Error('secret bucket detail'); } };
    const response = await handleSnapshot('bangkok-flood', failing);
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toBe('{"error":"snapshot unavailable"}');
    expect(body).not.toContain('secret bucket detail');
    expect(console.error).toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a generic 503 when reading the snapshot body throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing: SnapshotStore = { get: async () => ({ text: async () => { throw new Error('secret body detail'); } }) };
    const response = await handleSnapshot('bangkok-flood', failing);
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toBe('{"error":"snapshot unavailable"}');
    expect(body).not.toContain('secret body detail');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns the stored JSON bytes with cache headers', async () => {
    const body = '{"localMap":"bangkok-flood","raw":true}';
    const response = await handleSnapshot('bangkok-flood', store(body));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=300');
  });
});
