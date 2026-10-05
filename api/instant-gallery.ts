import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, ensure } from './_lib/rules.js';
import { createInstantGalleryService } from './_lib/instant-gallery.js';
import { createInstantGalleryRepository } from './_lib/instant-gallery-adapters.js';
import { tryPublicGalleryPreviewRelay } from './_lib/public-gallery-preview-relay.js';
export const config = { maxDuration: 180 };
export const instantGalleryService = (deadline = Date.now() + 165000) => createInstantGalleryService({ repository: createInstantGalleryRepository(deadline) });
export function createInstantGalleryHandler(service?: ReturnType<typeof instantGalleryService>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!service && await tryPublicGalleryPreviewRelay(req, res, 'public-gallery')) return;
      ensure(req.method === 'GET', 'METHOD_NOT_ALLOWED', 405);
      const query = new URL(req.url || '/api/instant-gallery', 'https://localhost').searchParams;
      const action = query.get('action') || 'list', active = service || instantGalleryService(); let data;
      if (action === 'list') {
        ensure([...query.keys()].every(key => ['action','limit','cursor'].includes(key)), 'INVALID_BODY');
        const raw = query.get('limit'); ensure(raw === null || /^[1-9][0-9]?$/.test(raw), 'PUBLIC_GALLERY_LIMIT_INVALID');
        data = await active.list({ ...(raw ? { limit: Number(raw) } : {}), ...(query.has('cursor') ? { cursor: query.get('cursor')! } : {}) });
      } else if (action === 'gift') {
        ensure([...query.keys()].every(key => ['action','id'].includes(key)), 'INVALID_BODY'); data = await active.get(query.get('id') || '');
      } else throw new AppError('ACTION_UNAVAILABLE', 404);
      res.statusCode = 200; res.end(JSON.stringify({ ok: true, data }));
    } catch (error) {
      const safe = error instanceof AppError ? error : new AppError('PUBLIC_GALLERY_UNAVAILABLE', 503);
      const allowed = new Set(['METHOD_NOT_ALLOWED','INVALID_BODY','INVALID_ID','ACTION_UNAVAILABLE','PUBLIC_GALLERY_LIMIT_INVALID','PUBLIC_GALLERY_CURSOR_INVALID','PUBLIC_GALLERY_GIFT_UNAVAILABLE']);
      const code = allowed.has(safe.code) ? safe.code : 'PUBLIC_GALLERY_UNAVAILABLE';
      res.statusCode = safe.status; res.end(JSON.stringify({ ok: false, error: { code, message: 'The public souvenir gallery could not be opened.' } }));
    }
  };
}
export default createInstantGalleryHandler();
