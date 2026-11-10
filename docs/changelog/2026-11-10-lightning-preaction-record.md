# The Lightning Pre-Action Record (2026-11-10)

Dan, in the big blind: "i clicked check fold but it didn't move me ... it made me hit fold again." Hand 58348210's cause could not be proven: nothing recorded what the engine did with a player's pre-action. The engine now records it.

## What is recorded

Every arm that reaches a Lightning room's pre-action door (POST /preaction), and every consequence of it, one row each in `public.lightning_preaction_event`:

| kind     | detail                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| set      | armed and held; `to_call` is the price owed at that moment                                                                                                                                                                                       |
| refused  | `no_hand_for_room`, `not_this_room` (the room proxy); `no_active_hand`, `left_hand`, `fold_pending`, `stale_hand` (with `requested_hand_id`), `invalid_action`, `not_in_hand`, `fold_refused:<code>`, `release_on_bet_refused:<code>` (the host) |
| pending  | an arm that became a fold request held until the seat's turn (`held_until_turn`)                                                                                                                                                                 |
| released | `on_arm` (already priced), `armed_check_fold_priced_by_bet`, `held_fold_priced_by_bet`                                                                                                                                                           |
| executed | at the turn: what it became (`check`, `call`, `fold`, or `<action>_rejected`); `held_fold_published` for a held fold made public in turn order                                                                                                   |
| rearmed  | `after_free_check` (Check/Fold carries)                                                                                                                                                                                                          |
| cleared  | `by_player`, `invalidated_by_bet`, `invalidated_at_turn`, `fold_requested`, `hand_end`                                                                                                                                                           |

## How

- `server/src/lightning/LightningPreActionRecord.ts`: `record()` is a synchronous push into a bounded buffer (5,000 events, oldest dropped and counted). A 1 s unref'd timer sends batches of 200 to `fn_lightning_preaction_record`, one call in flight. Each event carries its own id, so a retry after an unknown outcome inserts nothing twice; a batch is given up after three sends. "Function not found" drops the buffer and stays quiet for ten minutes. It never awaits on, and never throws into, the action path.
- `LightningHandHost` records each outcome through `deps.recordPreAction` (the process recorder otherwise); `LightningSeatProxy` records the two refusals made before any hand is found.
- `supabase/migrations/20261110213942_lightning_preaction_record.sql`: the table (no foreign keys, RLS on, no grants), the service-role write door (also deletes at most 2,000 rows older than fourteen days per call: no cron), and the read door.
- Scope: the pre-action door and its consequences. The LIGHTNING FOLD button is the action door and is not part of this record.
- Horses are recorded identically (CLAUDE.md 10.5); nothing reads whether a player is a horse. No cards.

## Reading it

```sql
SELECT * FROM public.fn_lightning_preaction_trace('<lightning hand id>');
```

returns every event for that hand (and every arm that named it), in order: time, player, kind, pre-action, detail, price owed, street.

## Tests

`server/src/lightning/LightningPreActionRecord.test.ts` (11): both big-blind cases (an armed Check/Fold released by the raise; an `auto_fold` held, released by the raise, published at the turn), the small blind released at the arm, every refusal reason, execution, re-arm and hand-end clear, a player clear and a bet invalidation, a clear by a fold request, a throwing recorder that cannot reach the action path, and the recorder's batching, retry idempotency, missing-function quiet and bound. Server Lightning suite: 54 files, 658 tests.

## Activation

The database half installs on merge. The engine half reaches production only through the daily 04:00 America/Chicago release.
