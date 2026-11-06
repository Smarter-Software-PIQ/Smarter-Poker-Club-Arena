/**
 * Keeps the maintenance level-clock store fed on every page (Dan 2026-11-05:
 * "IF THERE IS A MAINTENANCE BREAK IT NEEDS TO PAUSE ALL THE TOURNAMENT
 * CLOCKS AS WELL"). Tournament countdowns render on the lobby, the tournament
 * pages and the table; the store they read (utils/maintenanceLevelClock) must
 * know about a break wherever the player is, not only where a banner happens
 * to be mounted. Renders nothing.
 *
 * The countdown is exactly MAINTENANCE_BREAK_MS long and the engine stamps
 * break_ends_at = breakStartedAt + that length (MaintenanceBreak.beginCountdown),
 * so the countdown start, the instant the thaw credits every RUNNING event's
 * level clock from, is break_ends_at minus the break length.
 */
import { useEffect } from 'react';
import { useMaintenanceBreak } from '../../hooks/useMaintenanceBreak';
import { serverNow } from '../../utils/serverClock';
import { noteMaintenanceClock } from '../../utils/maintenanceLevelClock';

export const MAINTENANCE_BREAK_MS = 5 * 60 * 1000;

export default function MaintenanceClockSync(): null {
  const { maintenanceBreak } = useMaintenanceBreak();
  const { active, phase, breakEndsAtMs } = maintenanceBreak;
  useEffect(() => {
    noteMaintenanceClock(
      {
        active,
        phase,
        breakStartedAtMs:
          phase === 'counting_down' && breakEndsAtMs !== null
            ? breakEndsAtMs - MAINTENANCE_BREAK_MS
            : null,
        breakId: null,
      },
      serverNow()
    );
  }, [active, phase, breakEndsAtMs]);
  return null;
}
