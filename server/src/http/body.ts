/**
 * Bounded HTTP request body reader.
 *
 * Extracted from `server/src/index.ts` in Phase U3.2 (2026-04-23).
 *
 * FIX 175: enforces a 16 KB body-size limit to prevent memory exhaustion from
 * malicious clients. Any action payload in the poker engine fits easily.
 */

import type { IncomingMessage } from 'http';

export const MAX_BODY_SIZE = 16 * 1024; // 16KB — more than enough for any action payload

/**
 * ROLLING HANDOFF RELAY (2026-11-19, handoff/handoffRelay.ts). While an engine
 * is handing tables on, its relay reads a table POST body to learn which table
 * the request is for. When the request stays here, the body it read is parked
 * for this request so the handler reads exactly the same bytes (or the same
 * size refusal). Nothing is ever parked with ENGINE_ROLLING_HANDOFF off, so
 * this reader then behaves exactly as before.
 */
const prefetchedBodies = new WeakMap<IncomingMessage, string | Error>();

export function prefetchRequestBody(req: IncomingMessage, body: string | Error): void {
  prefetchedBodies.set(req, body);
}

export function readBody(req: IncomingMessage): Promise<string> {
  const prefetched = prefetchedBodies.get(req);
  if (prefetched !== undefined) {
    prefetchedBodies.delete(req);
    if (typeof prefetched === 'string') return Promise.resolve(prefetched);
    req.destroy();
    return Promise.reject(prefetched);
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
