# 2026-11-21: six incidents, their root fixes and the hardening after them (handoff)

One place to resume from. Each item names its PR; each PR carries its own
changelog and law.

| Incident | Root cause | Root fix | Hardening |
| --- | --- | --- | --- |
| bb04ee5f, e542fbd7, 887c0008 (table dbbc148e, 6 h engine kill storm) | `fn_cash_seat_move_execute` moved the chips but left the player's locked promo positions keyed to the old table; a later hand was refused (`original_winnings_sources_exceed_accepted_stack`) | #11619: `fn_ca_promo_follow_seat_move` in the move's own transaction; damage settled once (20261121142000/142714/143102) | #11642 (another lane): law over every seat mover; #11627 (another lane): a spent/refused successor claim holds the table instead of a kill loop; #11648: a deferred constraint trigger refuses any move that leaves a locked position behind, and the claim guard no longer needs a per-cause list |
| 90972d77 MergedMigrationNotInstalled | applier runs install in dispatch order, so a newer version could install before an older one and the chain guard refused the older | #11658: each applier run installs older pending ordinary files first, oldest first (no timing) | #11658: the dispatcher reports HELD, not "dispatched", while the applier is switched off; #11661: migration law censuses run in local pre-push |
| 484c4cee EngineReleaseFailed | a duplicate delivery of an already-sealed SHA failed on the pruned rollback image; the release alert carried no `engine_alert_episode_id`, so no resolve could ever match it | #11630 (another lane) stand-down; #11619 no alert for a shipped sibling | #11653: alerts carry their episode; the auto-resolve reads `received_at`; one sanctioned append-only resolve-by-episode path |
| 1e532243 hand gap watch | owned by another lane (#11562) | merged; live with the next sealed engine release | release stall root cause filed for the custodian in #11655 |

Open at hand-off (2026-11-21 19:20 UTC):

- No engine release has sealed since 04:10 UTC. Root cause in #11655: an owner-window booking merged during the 04:00 anchor's reservation span voided the date. Release custody is a locked lane; the custodian owns the fix.
- Installers were paused for the 1906z owner window. Migrations merged during the pause (20261121153607, 20261121182315, 20261121185031) install when `scripts/release/resume-migration-installs.sh` runs.
- The same episode-less alert defect exists for `OpenClawJobStale` in the smarter-poker-workers repo (incident 723a21ea); its producer needs the #11653 treatment there.
