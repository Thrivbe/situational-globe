import { getCloudflareContext } from '@opennextjs/cloudflare';
import { handleSnapshot, jsonError, type SnapshotStore } from './handler';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ localMap: string }> },
): Promise<Response> {
  const { localMap } = await params;

  try {
    const context = await getCloudflareContext({ async: true });
    // The R2 binding is read-write, but this route only reads snapshots.
    const env = context.env as unknown as { SNAPSHOTS?: SnapshotStore };
    return handleSnapshot(localMap, env.SNAPSHOTS);
  } catch (error) {
    console.error('[snapshot] Cloudflare context unavailable', error);
    return jsonError(503, 'snapshot unavailable');
  }
}
