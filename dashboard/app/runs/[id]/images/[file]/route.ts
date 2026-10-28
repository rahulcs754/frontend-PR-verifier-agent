import { readFile } from 'node:fs/promises';
import { imagePath } from '@/lib/runs';

/** Serves a run's screenshots. Names are validated, so nothing outside the run folder is readable. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  const path = imagePath(id, file);
  if (!path) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(path);
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': 'image/png',
        // A run's images never change once written.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
