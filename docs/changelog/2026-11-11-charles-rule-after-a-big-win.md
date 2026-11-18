# The Charles Rule after a +250 BB win, and durable bank-the-win state

Owner direction, 2026-11-11: "Even after a player completes their existing required hands, whenever they win a net pot of 250 big blinds or more, they must play another 10 hands before leaving." Plus the remaining corrections to #10390 / #10491 (Horses bank the win).

## The rule, as built

- **Where:** every chip cash game the Charles Rule already covers (Classic and Lightning, humans and Horses, the club's `hit_run_enabled` switch). Tournaments and Diamond tables never reach `fn_cash_session_evaluate` and stay outside it.
- **The win:** the authoritative settled hand's net for that player, read by `fn_cash_hand_net`:
  - Classic: `cash_hand_provenance_receipts.participants[].poker_delta`, which is stack after minus stack before for that hand, with top-ups held apart as inflow.
  - Lightning: `lightning_hand_player.net_result`.
  - Uncalled returns and recovered own chips cancel inside it. Side pots, chops, rake and jackpot drops are already applied.
  - Big blind: the hand's own `hand_history.big_blind`.
  - Measured 2026-11-11 over one hour: 0 mismatches between either source and its stack delta, and one receipt per hand. In the prior day about 700 settled hands would have qualified.
- **Counting:** at exactly +250 BB it applies, and the triggering hand is not counted. Hands are counted with the Charles Rule's existing eligibility (one count per dealt hand id, from the source the session plays through, Lightning pool hands included). Another qualifying win resets what is left to ten; it never adds ten, and ten is the most it holds, so a reset never shortens a longer obligation.
- **Where it lives:** the session row (`hr_big_win_*`). It survives reconnects, sit-outs (an undealt hand is not counted), seat moves (the move executors re-point this row) and engine replacement. A player cannot leave voluntarily while it is owed. A session that closes by a system exit (bust, closure, forced removal) closes with it, and a later re-entry carries only the start basis.
- **Enforcement:** one predicate, `fn_cash_session_hands_owed`: the larger of the countdown and the big-win count. It is read by:
  - the voluntary leave check, which also covers Lightning through `fn_lightning_hands_owed`;
  - the player's status, with a reason;
  - the club's countdown view;
  - the Lightning host's blind-off fold list (`fn_lightning_blind_off_players`), so the seat it folds is the seat its door holds;
  - the engine's mirror (`hitRunHandsRemaining` in `ChipContinuity.ts`), and through it the leave door, the sit-out hold, the blind off and the seat count.
- **Safety:** system exits are unchanged (closure, admin and forced removal, VPIP eviction, a bust). A stack of 0 owes nothing. The responsible-gaming waive finishes this obligation too.
- **Leave ordering:** each obligation keeps the existing pre-existing-leave exemption. A pending voluntary request stamped at or before the win's settlement stamp (`hr_big_win_at`, the evaluation's `clock_timestamp()`) is honoured. A request stamped after it is held. Tested at the exact boundary.
- **Display:** the existing count pill and the seat-side count show the hands and why ("After A Win Of 250 Big Blinds Or More"). The hand it starts, or a reset by a later win, is announced ("You Won 312.5 Big Blinds In One Hand. Play 10 Hands Before You Can Leave"). The Charles double toast no longer misfires when the big-win count is the one shown.

## Bank the win, finished

- **Starting stack (stable basis):** `cash_player_session.start_basis` is the session's opening buy-in, capped at the table maximum and set once at open.
  - Top-ups never touch it, because they raise `baseline` only.
  - A re-entry inside the rejoin window keeps the basis of the session it re-enters from, so the original basis is retained, not a value substituted later.
  - Seat moves keep the row.
  - The anti-rathole floor and every chip are untouched.
- **Orbit after a big pot:** `big_pot_hand_ref` and `hands_since_big_pot` live on the row, advanced by the same evaluation. The Classic engine reads them for both its decision and the rotator's gate; memory stands in only before the migration installs.
- **Every obligation first:** a Horse at its line leaves only when it owes no hand (countdown and big-win count), after an orbit since a big pot, and before its next big blind.
- **Lightning timing:** the in-process tracker is only a pre-filter. It asks once per pool session to learn the durable start basis, then only at that line, so a restart or re-entry cannot raise it. The door decides from `fn_lightning_bank_the_win_reading`:
  - the durable basis and orbit counter, and every hand owed;
  - the Horse's place in `fn_lightning_blind_order`, the pool's real big-blind order, against the number of big blinds the next formation needs.
  - Shared host-table seats are not used for either.
- **Leave retries:** bounded and idempotent.
  - One ask in flight per pool session, with one outcome per ask. An ask unanswered for 30 seconds is abandoned, and its late answer is ignored.
  - A refusal is one failed attempt.
  - A thrown or timed-out leave is uncertain: it is verified by re-reading before anything else, and never resent blindly.
  - The tracker stops after three failed attempts.
- **Restart gap:** a fresh engine's empty mirror read "nothing owed", so a sit-out clock could cash out a seat that still owed hands before the first sweep. Eviction now waits for the database's answer, for at most the first minute, so no seat is held indefinitely.

## Independent review

A reviewer who had not seen the work found three defects, all fixed before merge:

- the Lightning blind-off fold list still read only the countdown;
- the Lightning pre-filter's in-memory start could sit above the durable basis after a restart;
- the club view showed the countdown's total instead of the binding obligation's.

On its advice, re-entry no longer inherits an obligation (only the basis), "not found" is transient for the door, and a hung ask expires.

Accepted as documented limits:

- Duplicate settlement: a Lightning hand's trigger fires once (OLD.settled_at IS NULL), and a Classic table evaluates each hand once; a repeated report of the latest hand is idempotent (tested). There is no per-hand key for an older hand re-reported out of order, the same as the existing countdown.
- The next-big-blind test reads the pool's real blind order, against the number of hands the next formation needs.

## Withdrawn

The 33 in-profit Lightning exits with the count unfinished all asked to leave before their countdown started; `fn_cash_leave_check` honours that by design. They never showed broken enforcement. twincitycaro's early exit on 2026-11-11 06:11 stays unresolved: its engine logs were lost in the 09:27 container recreation, and missing logs cannot establish a cause.

## Activation

The migration carries `@install-window: daily-maintenance` (it alters `cash_player_session`), so it installs in the 04:00 Chicago window with the engine release that reads it. Obligations start only from hands evaluated after it installs; nothing is imposed from historical wins.
