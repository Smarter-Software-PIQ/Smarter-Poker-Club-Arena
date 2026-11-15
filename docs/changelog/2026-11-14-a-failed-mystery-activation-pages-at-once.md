# 2026-11-14: a failed mystery activation pages at once; Take My Seat names its tournament

## What happened

From about 23:33 UTC on 2026-11-14, `fn_mystery_bounty_seed` raised 42883 on every engine sweep:
20261114072509 passed `(SELECT sum(bigint) ...)`, which is `numeric`, to
`fn_mystery_sealed_ladder_for_open(uuid, integer, bigint)`. Union Mystery Bounty (PLO5) a5957f99
and Evening Mystery Bounty (PLO5) a88c4be4 reached their activation point and dealt nothing.
20261115001336 (PR #10884) cast the sum; both events resumed by 00:17 UTC, activated 7 chests each,
paid all 7 awards each and completed.

## Why nobody was paged for 20 minutes

The engine wrote `CRITICAL: mystery bounty seed FAILED` on every sweep, but
`server/src/services/errorReporter.ts` only writes to the console. The first page came from
`fn_ca_tournament_dark_while_running`, which sees the symptom after 20 live minutes.

## The change

`20261115015453_a_failed_mystery_activation_pages_at_once.sql`:

- The seed's body runs in a block that catches an unexpected error. The block rolls back (no
  chest, no stage change), `fn_ca_tournament_mystery_activation_failed` files ONE critical
  `financial_alerts` row per tournament (source `fn_ca_tournament_mystery_activation_failed`, filed
  as `tournament_lifecycle` by the existing `fn_ca_tournament%` class rule) and the seed answers
  `{ok:false, reason:'activation_failed'}`. The engine already treats any refusal other than
  `entry_still_open` as report-and-retry, so its behaviour does not change; only the page is new.
- Transient refusals (SQLSTATE classes 40, 08, 53, 57 and 55P03) are re-raised exactly as before.
  The last 22 hours of production logs held no other seed error, so nothing ordinary pages.
- The seed closes the alert itself on both success paths (the activation that commits, and a later
  call that finds the stage past pending) through `fn_ca_tournament_mystery_activation_recovered`.
  No sweep, detector or repair job (CLAUDE.md 10.11, 10.12).
- The edit is in place against the live body, pinned by md5 `16986022242d32fbda89a1e77dde67e0`,
  and was proven against production in a rolled-back pg_temp compile before merge.

`src/components/tournament/TournamentAutoSeat.tsx`: the blinding-off "Take My Seat" button now emits
`TABLE_SEATED` with the seat's `tournamentId`, the last tournament emitter that did not. With it, a
chair that was moved since its tab opened re-points that tab (PR #10887's rule: one tournament,
one chair, one tab) instead of opening a second one.

Pinned by `tests/a-failed-mystery-activation-pages-at-once.law.test.ts` and a new case in
`tests/tournament-registration-enters-game.law.test.tsx` (fails before, passes after).
