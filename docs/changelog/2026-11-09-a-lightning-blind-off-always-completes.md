# A Lightning blind off always completes (2026-11-09)

Bug report BUG-7C1347FF: a player in profit in a Lightning PLO4 pool pressed Leave with 7 of 10 hands still owed (Hit And Run, owner rule 2026-11-06), confirmed, and was stuck: count frozen at 3 of 10, leave refused, stack held on the anchor seat.

## Cause (read from production rows and the installed functions)

1. Every Lightning leave door calls `fn_lightning_stop_playing` first. It marked the stop and closed the pool session (`exit_reason = 'stop_playing'`) with no regard for hands owed. The reporting player's session closed at 00:57:21 UTC with `hr_hands_played = 3`, `hr_hands_required = 10`, `hr_blind_off = true`.
2. A closed pool session is never dealt, and `fn_lightning_blind_off_players` requires an open one, so the owed hands could not be played.
3. A disconnect reached the same end by two other routes: `fn_lightning_player_legality` refuses `DISCONNECTED` and `STOP_REQUESTED`, and `fn_lightning_reap_expired_disconnects` exits both.
4. Engine: `releaseLeavesHeldByClock` decided from the hand-count mirror, which only this table's own settlements and presence changes refresh. A Lightning anchor's count moves at the pool's settlement trigger, so the mirror went on reading "hands owed" after the count completed.

## Fix

Migration `20261109224717_a_lightning_blind_off_always_completes.sql` (function images only, no money, one transaction, md5 and anchor guarded):

- `fn_lightning_hands_owed(pool_session, confirmed_only)`: the one question, answered by `fn_cash_leave_check` (so a leave asked for before the countdown started is still honoured).
- `fn_lightning_stop_playing`: while hands are owed it neither marks nor exits, withdraws a standing mark, and answers `ok / exited false / deferred HANDS_OWED / hands_owed`.
- `fn_lightning_player_legality`: a confirmed blind off that still owes hands is legal despite `DISCONNECTED`, pool state `disconnected` or a stop mark. Its hand host checks or folds the seat.
- `fn_lightning_reap_expired_disconnects`: does not exit such a session for a disconnect or a stop. Responsible gaming still ends it; the hands still owed are waived (`hr_completed`, a `blind_off_waived` event) so the seat leaves with its chips through the ordinary voluntary cash-out.
- `fn_cash_session_set_blind_off` (patched in place): on confirmation at a Lightning anchor it withdraws a standing stop mark and re-enters the pool through `fn_lightning_pool_enter` if an earlier stop or disconnect closed the session.

Engine (separate pull request, not part of this change, taken by the engine release owner): a Lightning anchor's held-leave release must read each held seat's session fresh before deciding (`releaseLeavesHeldByClock` in `server/src/engine/ServerTableEngineBase.ts`). Until that ships, the owed hands are played and the leave door opens, but the cash-out fires on the player's next Leave press or an engine restart rather than on the next presence pass.

No client change: the leave doors only require `ok === true` from the stop, then the engine's hand count confirmation takes over.

## Decisions

- Responsible gaming outranks the hand count. An excluded player is never dealt again; the owed hands are waived on the record rather than left as an obligation nobody can play.
- A disconnect the player did not confirm as a leave keeps its existing treatment (not dealt, expired after the timeout, seat and count kept).
- A seat that is sat out is not dealt by this change; the anchor's existing sit-out clock owns it.

## Proof

- `scripts/qualify-lightning-blind-off.mjs` (run by `.github/workflows/lightning-hand-counts-every-player-dealt-in.yml`): a throwaway cluster with the installed production definitions (hash-checked against production), run before the migration (S1, S2, S4, S6 reproduce the strand) and after it (each completes; S3, S5, S7 hold in both).
- `tests/a-lightning-blind-off-always-completes.law.test.ts`.

## Not in this change

The reporting player's own seat and the other seats already in this state are not edited here. With the migration installed, the next confirmation the engine sends for a seat whose session still says `hr_blind_off` (a restart restores every such hold) re-enters the pool and the owed hands are played.
