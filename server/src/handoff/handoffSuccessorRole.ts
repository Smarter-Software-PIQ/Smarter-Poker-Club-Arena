/**
 * HANDOFF SUCCESSOR BOOT ROLE AND RELAY PEER (2026-11-19, docs/ENGINE-ROLLING-HANDOFF.md).
 *
 * Owner order (Dan, 2026-11-19 12:54 Chicago): "WE NEED TO STOP REQUIRING AN
 * ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
 *
 * Both settings are read ONLY while `ENGINE_ROLLING_HANDOFF=on`. With the flag
 * off neither has any effect, whatever its value, so an engine started with a
 * stray `ENGINE_ROLE` boots exactly as it did before this file existed.
 *
 *   ENGINE_ROLE=handoff-successor
 *     The process boots as the successor of a serving engine: it becomes
 *     ready to deal (horse and equity lanes, lease renewal, weekly payout
 *     custody) but runs no discovery, claims no unhanded table and runs no
 *     singleton job. It deals only units handed to it through the
 *     coordinator, and takes leadership (discovery, sweeps, every singleton
 *     job) only when the serving engine has retired and released the
 *     leadership row. Any other value, or no value, is the ordinary boot.
 *
 *   ENGINE_HANDOFF_PEER_PORT=<port>
 *     The loopback port of the OTHER engine of the pair. The engine that
 *     yields relays HTTP and WebSocket traffic for tables it handed on to this
 *     port until it retires; the successor mirrors its tournament channel
 *     broadcasts to it while that engine is still the front door. Unset, not
 *     an integer 1..65535, or equal to this process's own PORT: no relay and
 *     no mirror (a move then still works, but a moved table answers 404 from
 *     this engine, as before).
 */
import { rollingHandoffEnabled } from './rollingHandoffFlag.js';

export const ENGINE_ROLE_ENV = 'ENGINE_ROLE';
export const HANDOFF_SUCCESSOR_ROLE = 'handoff-successor';
export const HANDOFF_PEER_PORT_ENV = 'ENGINE_HANDOFF_PEER_PORT';

type Env = Readonly<Record<string, string | undefined>>;

/** True only with the flag on and ENGINE_ROLE exactly `handoff-successor`. */
export function bootsAsHandoffSuccessor(env: Env = process.env): boolean {
  return rollingHandoffEnabled(env) && env[ENGINE_ROLE_ENV] === HANDOFF_SUCCESSOR_ROLE;
}

/** The peer engine's loopback port, or null (flag off, unset, malformed or our own port). */
export function handoffPeerPort(env: Env = process.env): number | null {
  if (!rollingHandoffEnabled(env)) return null;
  const raw = env[HANDOFF_PEER_PORT_ENV];
  if (typeof raw !== 'string' || !/^[0-9]{1,5}$/.test(raw.trim())) return null;
  const port = Number(raw.trim());
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
  const own = Number.parseInt(env.PORT || '8080', 10);
  if (port === own) return null;
  return port;
}
