# tests/a-maintenance-break-pauses-every-tournament-clock.law.test.ts

Dan 2026-11-05: "IF THERE IS A MAINTENANCE BREAK IT NEEDS TO PAUSE ALL THE
TOURNAMENT CLOCKS AS WELL, THEY SHOULD NOT BE RUNNING DURING A MAINTENANCE
PAUSE." The engine already held every level inside the freeze and
fn_thaw_platform shifted each RUNNING event's `level_started_at` by the frozen
time, but every screen counted down from the pre-freeze anchor through the
break and jumped back at the release. The law pins `utils/maintenanceLevelClock`
through `getCurrentLevelState`: the level clock keeps running through the
last-hand phase, stops at the countdown start (the thaw's freezeStartedAt),
stays stopped through finalizing, resumes after the release where it stopped
with no jump while the row still carries its pre-freeze anchor, takes the real
clock once the shifted anchor arrives, never touches an event that is not
running or is on its own synchronized break, and starts fresh for a later break.
