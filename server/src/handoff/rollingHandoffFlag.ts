/**
 * ROLLING HANDOFF FLAG (owner order 2026-11-19 12:54 Chicago: "WE NEED TO STOP
 * REQUIRING AN ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND
 * FIXES").
 *
 * OFF unless the environment says exactly `ENGINE_ROLLING_HANDOFF=on`. With
 * the flag off GameServer never constructs a RollingHandoffCoordinator, every
 * guard it reads is an optional chain on `null`, and no route answers for it,
 * so the engine behaves exactly as it did before this module existed. Any other
 * value ("1", "true", "ON", a typo) is OFF: turning on a second engine owner
 * must be a deliberate act, never a parsing accident.
 *
 * Design: docs/ENGINE-ROLLING-HANDOFF.md.
 */
export const ROLLING_HANDOFF_FLAG = 'ENGINE_ROLLING_HANDOFF';

export function rollingHandoffEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[ROLLING_HANDOFF_FLAG] === 'on';
}
