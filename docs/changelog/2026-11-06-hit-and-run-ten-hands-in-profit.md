# Hit And Run: Ten Hands In Profit, The Charles Rule, Blinded Off On Early Leave

Owner direction, 2026-11-06, every cash game (Classic and Lightning):

- "ONCE A PLAYER 'IS IN PROFIT' AT A TABLE... THEY CAN NOT LEAVE THE TABLE UNTIL THEY PLAY 10 HANDS IN PROFIT. IF THEY DROP BACK DOWN TO 'NOT IN PROFIT' THEY CAN LEAVE AT ANY POINT."
- "THOSE 10 HANDS SHOULD BE DISPLAYED AND COUNTED DOWN AFTER THE COMPLETION OF EACH HAND."
- "IF THEY TRY TO LEAVE THE GAME BEFORE THE HANDS ARE COMPLETED, THEY SHOULD RECEIVE A FULL SCREEN POP UP THAT SAYS, YOUR HAND COUNT IS NOT COMPLETED, ARE YOU SURE YOU WANT TO LEAVE? YOU WILL BE BLINDED OFF FOR THE REMAINING HANDS."
- THE CHARLES RULE: doubling up during the countdown adds ten hands, and each further double ten more. Completed hands free the player for the rest of the session; losing all the profit clears an uncompleted countdown, and coming back into profit starts the ten-hand clock again.

## The count (database)

Migration `20261106203853_hit_and_run_ten_hands_in_profit` (daily-maintenance window, DDL and function images only, each replaced image md5-guarded):

- `cash_player_session` gains `hr_hands_required`, `hr_hands_played`, `hr_reference_stack`, `hr_doubles`, `hr_completed`, `hr_last_hand_ref`, `hr_started_at`, `hr_engine_ack`, `hr_blind_off`.
- `fn_cash_session_evaluate` advances the state machine once per dealt hand (`hand_id` is the idempotency key): out of profit -> nothing; into profit -> countdown of 10 from the next hand, reference stack = this stack; in countdown and still in profit -> one hand played, stack >= 2 x reference adds 10 and resets the reference (Charles); profit gone -> cleared; played >= required -> completed for the session. Baseline is buy-in plus add-ons/rebuys.
- Classic hands are reported by the engine's settlement (`hand_source` table, dealt players only); Lightning hands by `fn_lightning_cash_clock_at_settlement` (`hand_source` lightning). A session counts only the source it plays through, so no hand counts twice.
- `fn_cash_leave_check` (already called by `atomic_seat_cashout_locked` for every voluntary cash-out, under the seat lock) refuses while hands are owed, only for sessions an engine serving the rule has acknowledged (`hr_engine_ack`), so an older engine can never strand a player. A leave requested before the countdown started (pending for that exact occupancy) is honoured. System exits (kick, closure, VPIP boot) are unchanged.
- `fn_cash_session_set_blind_off`, `fn_lightning_blind_off_players` (engine-only) and `fn_my_hit_run_status` (the player's own count).

## Blinded off (engine)

- `leaveTable` asks first: with hands owed and no `confirmHandCount` it returns `LEAVE_LOCKED` + `needs_confirmation` + `hands_remaining` and changes nothing. With confirmation it holds the leave (`leaveHeldByClock`), records the blind-off, folds the live hand and answers success.
- A held classic seat is sat out but still dealt in (`dealsInWhileSittingOut`, the tournament sit-out treatment): it posts its blinds and is checked or folded on its turn, while at least one playing seat is dealt in with it. `releaseLeavesHeldByClock` cashes it out through the voluntary door once the hands are played or the profit is gone; with nobody else left to play it is released as a system exit.
- Sit-out, away and abandoned-seat evictions of a seat that still owes hands blind it off instead of cashing it out (that would be the hit and run itself). The VPIP boot stays a system exit.
- Lightning: a held anchor seat is not sat out; it reports present through its anchor engine and its hand host checks or folds it on its turn; when its hands are played the leave is queued behind the live Lightning hand. A Lightning leave reads the anchor's count fresh first.
- The hold survives an engine restart (`hr_blind_off` on the session, restored by the first presence sweep). Sitting back in withdraws it.

## Client

- `HitRunLeaveConfirm`: the full-screen, fully opaque confirmation. Every leave door (menu, felt button, leave-after-this-hand, tab X) checks `fn_my_hit_run_status` first and opens it before anything is sent; Stay changes nothing, Leave resends with `confirmHandCount`. A confirmed Lightning leave does not stop matchmaking.
- `HeroVpipTracker` shows "Hands Before You Can Leave N" beside the hero, refreshed after every hand (classic from the seat payload, Lightning from the database).

Activation: the database file installs in the 04:00 America/Chicago window with the engine; the client works against both the old and new engine.

Regressions: `tests/unit/hitAndRunHandCount.pg.test.ts` (isolated PostgreSQL), `server/src/engine/ChipContinuityLeave.behaviour.test.ts`, `server/src/engine/ChipContinuity.law.test.ts`, `tests/hit-and-run-leave-confirm.law.test.tsx`.

## Follow-up (owner 2026-11-06: "FULLY BUILD, FIX AND ENHANCE ALL OF THESE")

- **The Charles Rule is announced.** When a double adds hands the hero gets a toast: "You Doubled Up. 10 Hands Added Before You Can Leave" (`useHandsAddedByDouble`, read from the countdown total the engine now sends as `hit_run_hands_required`).
- **One question per leave.** Every Leave Table door goes through `openLeaveConfirm`: with hands owed, the full-screen hand-count confirmation is the only dialog (the generic "Leave Table?" is skipped). The database count is still read before anything is sent.
- **The tab X asks on its own table.** With hands owed, the multi-table container brings that table forward and asks there instead of putting the lobby up over the question.
- **The count between Lightning hands.** A seatless Lightning hero sees `HitRunCountPill` above the action area until the next hand is dealt.
- **The confirmation renders over everything** (portal on `document.body`).
- **Club Data shows who owes hands.** New panel on the Club Data page (`ClubHitRunPanel`) reading `ca_club_hit_run_status` (migration `20261107020241`, daily window, after `20261106203853`): owners, co-owners and admins see the club, agents their downline, anyone else is refused; deleted players never appear. Rows: player, table and stakes, "X Of Y", Blinded Off or Playing. Refreshed every 30 seconds.
- **Horses play their owed hands.** The rotator does not ask a seat that owes hands to leave, holds a refusal about 20 seconds per owed hand, and the two departures that must happen (lone stand, booked tournament) confirm the count the way a person would. The engine's voluntary stay answers from its mirror instead of asking the database every hand.
- **The ten-minute stay clock is retired from the client** (state, tick, "Leave Available In" label, the tracker's "Your Time Clock Has Started", the confirm dialog's locked label, `src/lib/chipContinuity.ts`). Older engines' stay-clock fields are ignored.
- **Bomb pots: the settings page is fixed at 30 minutes**, and `fn_update_table_bomb_settings` stores 1800 seconds for every timed bomb pot (migration `20261107015928`).
