import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/** Explicit TCP accept-queue backlog matching host net.core.somaxconn (4096). */
export const HTTP_LISTEN_BACKLOG = 4096;

/** Loopback-only host for Docker HEALTHCHECK; never published outside the container. */
export const INTERNAL_LIVENESS_HOST = '127.0.0.1';
export const INTERNAL_LIVENESS_PORT_OFFSET = 10000;
export const DEFAULT_INTERNAL_LIVENESS_PORT = 8080 + INTERNAL_LIVENESS_PORT_OFFSET;

export interface InternalLivenessVerdict {
  running: boolean;
  liveness: 'ok' | 'standby' | 'dead' | string;
}

/**
 * Derive the default container-local liveness port from the main HTTP port
 * (`mainPort + 10000`, e.g. `8080 -> 18080`, `8081 -> 18081`). Never collides
 * with `8080`/`8081` or a rolling-handoff `ENGINE_HANDOFF_PEER_PORT`.
 */
export function defaultInternalLivenessPort(mainPort = 8080): number {
  const normalized =
    Number.isInteger(mainPort) && mainPort >= 1 && mainPort <= 65535 ? mainPort : 8080;
  const candidate = normalized + INTERNAL_LIVENESS_PORT_OFFSET;
  return candidate <= 65535 ? candidate : normalized - INTERNAL_LIVENESS_PORT_OFFSET;
}

/**
 * Parse INTERNAL_LIVENESS_PORT. Explicit `0` or `off` disables binding (useful
 * for isolated harnesses); unset, invalid, or colliding (`=== mainPort`) values
 * fall back cleanly to `defaultInternalLivenessPort(mainPort)`.
 */
export function resolveInternalLivenessPort(
  env: Readonly<Record<string, string | undefined>> = process.env,
  mainPort?: number
): number {
  const parsedEnvPort = env.PORT !== undefined ? Number(env.PORT.trim()) : Number.NaN;
  const effectiveMainPort =
    mainPort !== undefined && Number.isInteger(mainPort) && mainPort >= 1 && mainPort <= 65535
      ? mainPort
      : Number.isInteger(parsedEnvPort) && parsedEnvPort >= 1 && parsedEnvPort <= 65535
        ? parsedEnvPort
        : 8080;
  const fallback = defaultInternalLivenessPort(effectiveMainPort);
  const raw = env.INTERNAL_LIVENESS_PORT?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === '0' || raw === 'off' || raw === 'false') return 0;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 && parsed !== effectiveMainPort) {
    return parsed;
  }
  return fallback;
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
