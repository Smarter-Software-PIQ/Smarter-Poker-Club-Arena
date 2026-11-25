import { chmodSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A SCRATCH POSTGRES LISTENS ON ITS OWN SOCKET, NEVER ON A GUESSED TCP PORT (2026-11-24).
 *
 * Twelve vitest Postgres tests started their server on a port drawn from
 * 20000 + random * 30000 on the loopback TCP address. Over half of that range
 * sits inside Linux's ephemeral range (32768-60999), where any outbound
 * connection on the runner (every psql these same tests open, npm, the other
 * shards' servers) may already hold the port. When it does, the postmaster
 * cannot bind, `pg_ctl -w start` answers "could not start server" within a
 * second, and the test fails with nothing wrong in the code under test; a
 * rerun picks another number and passes. PR #11911's first run lost
 * playedHeadsUpClubRetirement.pg.test.ts exactly that way (1.5 s, no server
 * log in the output). The CI Python harnesses were fixed for the same cause on
 * 2026-11-07 (tests/a-test-database-never-guesses-a-tcp-port.law.test.ts).
 *
 * Every client in these tests connects through PGHOST, so the server needs no
 * TCP address at all: it listens on a Unix socket in a directory only this
 * test owns, and two servers can never ask for the same address. The socket
 * directory lives under the OS temp directory, not the scratch directory,
 * because a Unix socket path is capped (104 bytes on macOS, 108 on Linux) and
 * the repository-relative scratch path on a CI runner is longer than that.
 */

const SOCKET_FILE = '.s.PGSQL.5432';
/** sun_path holds 104 bytes on macOS (108 on Linux), terminator included. */
const MAX_SOCKET_PATH = 100;

/** The port number only names the socket file; nothing listens on TCP. */
export const SCRATCH_POSTGRES_PORT = '5432';

/**
 * A fresh directory for one server's socket. When the suite runs as root the
 * server runs as an unprivileged user, so the directory is opened to it.
 */
export function scratchPostgresSocket(): string {
  const base = [tmpdir(), '/tmp'].find(
    (dir) => join(dir, 'pgs-XXXXXX', SOCKET_FILE).length <= MAX_SOCKET_PATH
  );
  if (!base) throw new Error('no temp directory short enough for a PostgreSQL socket');
  const dir = mkdtempSync(join(base, 'pgs-'));
  if (typeof process.getuid === 'function' && process.getuid() === 0) chmodSync(dir, 0o777);
  return dir;
}

/** The postmaster options for pg_ctl -o: socket only, no TCP listener. */
export function scratchPostgresListenOptions(socket: string): string {
  return `-p ${SCRATCH_POSTGRES_PORT} -k '${socket}' -c listen_addresses=''`;
}

/**
 * Run a `pg_ctl ... start`, and when it fails, fail with the server's own log
 * appended: "could not start server / Examine the log output" alone is the
 * reason the original failures could not be diagnosed from the CI output.
 */
export function showServerLogWhenStartFails<T>(log: string, start: () => T): T {
  try {
    return start();
  } catch (error) {
    const text = existsSync(log) ? readFileSync(log, 'utf8').slice(-4000) : '(no server log)';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n--- PostgreSQL server log (${log}) ---\n${text}`, {
      cause: error,
    });
  }
}
