# Heads Up Rematch (2026-11-08) - BLOCKED ON THE MONEY PATH, NOT SHIPPED

Dan, verbatim: "WHEN PLAYERS ARE PLAYING 'HEADS UP' WHEN THE MATCH IS OVER, THEY
SHOULD BOTH RECEIVE A 'PLAY AGAIN' POP UP, AND IF BOTH PLAYERS AGREE, THE MATCH
STARTS AGAIN. THEY BOTH 'BUY BACK IN' RAKE IS TAKEN AND THE MATCH STARTS BACK
OVER AT THE START OF THE HEADS UP."

## Status

This branch holds a working agreement flow, but **the buy-back-in does not yet
meet the owner's acceptance rules**:

1. both players accept before either is charged;
2. each is charged exactly once, through the normal buy-in path;
3. both reach the same fresh table;
4. a decline, a timeout or a repeat tap leaves no partial and no duplicate charge.

On this branch each client buys its own seat after the match is made. Rule 4
rules that out: if A's purchase commits and B's never arrives, A is charged
alone. The rules need both purchases in **one transaction**, run by the second
acceptance. The existing money path cannot do that (see Findings), and no new
money path was invented. **Do not merge this branch as it stands.**

## What is built

- `supabase/migrations/20261108203134_heads_up_rematch.sql`
  - `public.ca_heads_up_rematches`: private by RLS (a participant reads its own
    row, nobody writes). No foreign key to a hot table.
  - `fn_ca_heads_up_rematch_core` (no browser grant) and two browser doors:
    `ca_heads_up_rematch_respond(uuid, boolean)` and
    `ca_heads_up_rematch_state(uuid)`. Answers: `none`, `waiting_for_you`,
    `waiting_for_opponent`, `finding_table`, `matched` (with `table_id` and
    `seat_number`), `opponent_declined`, `you_declined`, `no_open_game`,
    `entries_closed`, `expired`, `not_eligible`. The waiting answers also
    carry `seconds_left`.
  - When both have accepted, the core picks an empty sibling game that is
    REGISTERING and matches the finished game exactly (club, union, buy-in,
    fee, game, variant, format, satellite target, free buy). It locks the game
    with `FOR UPDATE SKIP LOCKED` behind a short advisory lock, resolves the
    table through `fn_tournament_primary_table`, gives the winner seat 1 and
    the runner-up seat 2, and holds the table for 60 s.
  - Deadlines are checked when a row is read, never swept. Nothing is matched
    while entries are frozen or the daily window is closed.
  - A horse opponent says yes the way a person would: it asks 4 to 20 s after
    the game ends, or answers 2 to 8 s after the person asks. Nothing tells
    the browser it is a horse (CLAUDE.md 10.5).
  - `fn_take_seat_and_buy_in` and `fn_seat_horse_in_seat_first_game` are
    re-declared with their production bodies unchanged and one read-only
    check first: a held table refuses everyone else with `seat_reserved`.
- Client: `src/services/headsUpRematch.ts` holds the answers and the card
  copy. `TournamentRankingHost` polls every 1.5 s while the card is up.
  `TournamentRankingCard` takes a `rematch` prop. `seat_reserved` reads "That
  Seat Is Reserved For A Rematch". Closing the card counts as a No.
- Both the winner and the loser get the card. The winner's exit
  (`tournament_winner` -> `exitFromDurableCompletion` -> `goToLobbyWithResult`)
  uses the same publisher as the bust.

## Findings: why one transaction cannot charge both players today

Read from production and confirmed with one self-aborting probe on 2026-11-08:

- `fn_register_for_tournament(uuid, boolean)` refuses unless
  `fn_caller_session_is_live()`, takes the payer from `auth.uid()`, and its
  core (`fn_register_for_tournament_before_atomic_capacity_20260907`) declares
  `v_uid uuid := auth.uid()`. Called with no login it answers
  `{"ok": false, "reason": "missing_user_id"}`. Only the caller can ever be
  charged.
- The only registration door that takes an explicit user id,
  `fn_register_horse_for_tournament(uuid, uuid, boolean)`, answers
  `{"ok": false, "reason": "not_a_horse"}` for a person.
- The only other way in would be to set `request.jwt.claim.sub` /
  `request.jwt.claims` to the other player inside the transaction. That is
  impersonation, and it would also need a forged `session_id`, because
  `fn_caller_session_is_live` checks `auth.sessions`. Not done.

## Options for the owner (one is needed before this can ship)

1. **An explicit-payer layer on the person's core.** Refactor the core so the
   payer is a parameter. The existing door passes `auth.uid()` and the rematch
   passes each consenting player. Same charge, same ledger rows, same fee
   split. This changes the money path, so it needs an explicit go-ahead.
2. **A consent token, with the charge still made by the player's own call.**
   Not atomic across two players, so it fails rule 4 on its own.
3. Drop the rematch charge and keep the existing Play Again (no change).

## Engine follow-up (separate PR, 04:00 window), not started

Prefer the reserved horse for the held table, and skip the human partner hold
when the reserved opponent is a horse. This belongs in
`TournamentRecurringService.topUpWithHorses`, in the seat-first branch after
`seatFirstHumanPartnerHold`: read `ca_heads_up_rematches` for
`target_tournament_id` with `reserved_until > now()`, return early from the
hold, and put that horse first in `candidates`. It waits on the decision
above.
