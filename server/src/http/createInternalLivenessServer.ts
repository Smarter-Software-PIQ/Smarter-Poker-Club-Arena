import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/** Explicit TCP accept-queue backlog matching host net.core.somaxconn (4096). */
export const HTTP_LISTEN_BACKLOG = 4096;

/** Loopback-only host for Docker HEALTHCHECK; never published outside the container. */
export const INTERNAL_LIVENESS_HOST = '127.0.0.1';
export const DEFAULT_INTERNAL_LIVENESS_PORT = 8081;

export interface InternalLivenessVerdict {
  running: boolean;
  liveness: 'ok' | 'standby' | 'dead' | string;
}

/**
 * Parse INTERNAL_LIVENESS_PORT. Explicit `0` or `off` disables binding (useful
 * for isolated harnesses); unset or invalid values default to 8081.
 */
export function resolveInternalLivenessPort(
  env: Readonly<Record<string, string | undefined>> = process.env
): number {
  const raw = env.INTERNAL_LIVENESS_PORT?.trim().toLowerCase();
  if (raw === undefined || raw === '') return DEFAULT_INTERNAL_LIVENESS_PORT;
  if (raw === '0' || raw === 'off' || raw === 'false') return 0;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  return DEFAULT_INTERNAL_LIVENESS_PORT;
}

/**
 * Lightweight loopback-only `/livez` server (incident b87d2b52 / 7bf7a01f).
 *
 * Isolates Docker's HEALTHCHECK from public port 8080's TCP accept queue and
 * 168 KB `/health` serialization. Returns only `{ running, liveness }` in O(1)
 * with zero disk I/O, zero worker structuredClone, and zero public exposure.
 */
export function createInternalLivenessServer(getLiveness: () => InternalLivenessVerdict): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = req.method || 'GET';
      const url = (req.url || '/').split('?')[0] || '/';
      if (url !== '/livez') {
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end('{"error":"Not found"}');
        return;
      }
      if (method !== 'GET') {
        res.writeHead(405, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end('{"error":"Method not allowed"}');
        return;
      }
      const verdict = getLiveness();
      const healthy =
        verdict.running === true && (verdict.liveness === 'ok' || verdict.liveness === 'standby');
      res.writeHead(healthy ? 200 : 503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ running: verdict.running, liveness: verdict.liveness }));
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end('{"error":"Internal Server Error"}');
      } else {
        res.destroy();
      }
    }
  });
}
