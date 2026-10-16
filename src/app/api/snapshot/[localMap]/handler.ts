import { findLocalMap } from '@/situations/registry';

export interface SnapshotStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export const jsonError = (status: number, error: string): Response => Response.json(
  { error },
  { status, headers: { 'Cache-Control': 'no-store' } },
);

export async function handleSnapshot(id: string, store?: SnapshotStore): Promise<Response> {
  if (!findLocalMap(id)) return jsonError(404, 'not found');
  if (!store) {
    console.error('[snapshot] SNAPSHOTS binding is unavailable');
    return jsonError(503, 'snapshot unavailable');
  }

  try {
    const object = await store.get(`snapshots/${id}.json`);
    if (!object) return jsonError(404, 'not found');
    const body = await object.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300',
      },
    });
  } catch (error) {
    console.error('[snapshot] R2 read failed', error);
    return jsonError(503, 'snapshot unavailable');
  }
}
