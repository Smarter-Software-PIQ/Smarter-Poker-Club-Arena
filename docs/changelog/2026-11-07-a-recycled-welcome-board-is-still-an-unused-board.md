# 2026-11-07 - A Recycled Welcome Board Is Still An Unused Board

## What happened

Every Club Create Certification since 2026-11-03 ended "Stale recovery left 11 of 11 stale account(s) unrecovered". Run 42409273134 named `WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED` three times, then `cleanup_reserved_certification_account` 500s (`CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY`).

The three refusals are the welcome fixtures of runs that died on 2026-11-01/02: Crest Cert Template 6dc7e348, fba91d7b and 32085314. Nobody ever sat in them. `fn_daily_window_close_seat_first_lobbies` cancels every open seat-first lobby at 3 AM Chicago and the welcome board comes back, so each club held 12 open boards plus 58-59 cancelled earlier generations. Each of those generations has an immutable receipt with zero players, seats, refunds, tickets, fees and rake. A platform rollout on 2026-11-03 also gave each club six non-package Classic cash games with one empty table each.

- The certification door deletes the club, so it can never retire one whose receipts must be kept, and it refuses any tournament outside the 12 current boards.
- The owner's own Retire Club door (`fn_retire_settled_club`) refused with `WELCOME_PACKAGE_BOARD_LINEAGE_AMBIGUOUS`, because the welcome unwind counted a cancelled earlier generation as a second copy of the board. That also blocks a real owner whose unused board was recycled once.

## Fix

Migration `20261107211612`:

- `fn_unwind_unused_first_club_welcome_package`: the ambiguity count skips an earlier generation that is cancelled, never started, has no current player and has a receipt that moved nothing. The patch is applied in place from the exact installed definition (md5 gate, one anchor). Every play and registration check still covers that generation.
- New `fn_ca_retire_stale_welcome_fixture_with_history(club, reason)`, service role only, for reserved certification fixtures:
  - proves the only member is the zero-balance owner, with no agent;
  - proves no seat, entrant or hand ever;
  - proves every tournament is an untouched open board or a cancellation that moved nothing;
  - then closes the fixture's own idle non-package tables through `fn_close_managed_game` and retires the club through `fn_retire_settled_club` as its owner, carried as platform operations.
  - The club becomes retired with every record kept, and the identity stays as owner of record (`retained_terminal_fixture_owner`).

`scripts/ci/production-e2e-account.mjs`: the stale sweep asks that door when, and only when, the certification door answers `WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED` for a fixture that is not this run's own template, over both the direct database and REST transports.

`fn_ca_prepare_unused_welcome_certification_board_games` is unchanged. Accepting the earlier generations there could not retire anything, because the same door then deletes the club and refuses any club that still has a tournament.

## Proof

A rolled-back production probe (one DO block ending in RAISE) of exactly this patch and sequence retired 96bd011b: 6 tables closed, unwind ok, lifecycle `retired`, all 71 tournaments CANCELLED with their receipts kept. Without the patch the owner door answered `WELCOME_PACKAGE_BOARD_LINEAGE_AMBIGUOUS`.

Tests: law `tests/a-recycled-welcome-board-is-still-an-unused-board.law.test.ts`, unit `tests/unit/staleWelcomeFixtureHistoryDoor.test.ts`.

## Not covered here

Four stale "Cert RH" player identities have seat history in retired fixture clubs. The account door correctly refuses to remove them (`CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY`). Classifying them as identities of retired history is a separate change.
