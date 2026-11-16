# A club's rake day counts the hand for the club of the sitting it was dealt from (2026-11-16)

Owner rule (2026-11-15): a player can play in several clubs; each club's numbers
reflect only the hands played through that club, and nothing is excluded or
moved because a player belongs to several clubs.

Migration: `supabase/migrations/20261116021751_a_club_rake_day_counts_the_hand_for_the_seat_club.sql`
(draft, `do-not-merge`; nothing installed).

## The defect, read from rows

`fn_ca_club_rake_daily_compute` (the per-day club rake rollup, run at every
raked cash hand's COMMIT and by the rebuild doors) splits a UNION cash hand by
player and credits each player's part to a club by:

1. the hand's `rake_attributions` witness for that player;
2. the latest buy-in receipt at that table at or before the hand;
3. the latest `table_seats` row at that table at or before the hand;
4. **the player's first-joined club in the union** (`club_members ... ORDER BY joined_at ASC`);
5. the table's club.

Every positive contribution has a witness (0 exceptions in every window of
2026-11-01..14), so no chip ever reaches step 2. The rows that do are players
dealt in who put nothing in the pot - nearly all horses. A zero contribution
moves no rake, but it adds the hand to that club's `ca_club_rake_daily.hands`
(Club Dashboard revenue tab, Club Financials rake per hand / average pot).

Step 4 is a membership guess. Steps 2 and 3 are dated but **not bound to the
sitting**: they take the newest receipt or seat row that started before the
hand, which can belong to an earlier sitting through another club. In
2026-11-14 06:00-06:20, 1,099 zero-contribution rows had a receipt only from
an earlier sitting at that table (2 h 25 m to 35 days old); 152 named KINGS
CLUB and 151 of those had a witness in their own sitting naming another club.

## The first draft of this fix, and why it was replaced

The first draft replaced step 4 with (a) the seat's exit record
(`ca_seat_stack_exits`, first exit by the player from the table within 7
days) and (b) the player's own earlier attribution at the table within a day
with no exit logged in between. Neither is bound to the sitting:

- `fn_log_seat_stack_exit` (production text) writes an exit row only when the
  seat is left **with chips** and never on a diamond table. A bust-out, and the
  seat move (which zeroes the stack before leaving), leave no row. 0 of 64,494
  union exit rows since 2026-11-01 have a zero stack.
- Seat rows are reused: re-seating paths UPDATE a left row back to live
  (`fn_seat_stage_entitlement`, `fn_cash_seat_move_execute_*`,
  `fn_cash_seat_swap_execute_*`, ...), so `seat_id` alone is not a sitting.
- Horses do re-sit at the same union table through different clubs: 646 horse
  player-tables since 2026-11-01 have exits through more than one club. On
  2026-11-02 alone, 14 exit rows through club Y followed 48 sittings through a
  different club X (3,221 witnessed hands) that ended with no exit row. Example
  (table `a8cbda4f`, horse `7e2aea2c`): 62 zero-contribution hands of a sitting
  played through `a41434bb`; lookup (a) returns `2a1132b9` (an exit 16 h later
  from another seat row) and the installed step 2 returns `a0000000` (a
  receipt of 2026-10-27).
- In samples, lookup (a) came from a different seat row than the hand's in 8
  of 266 and 53 of 89 uses. Lookup (b) has the same exposure (re-sit with no
  exit row in between), proven in the isolated test below.

## What changes

The hand's own commit record names the sitting. `hand_atomic_commits.stack_result.request.stacks`
holds, for every player dealt in, `seat_id` and `seat_joined_at` (present on
every union hand from 2026-11-07 18:18 UTC; 143,122 union hands of 2026-11-01..07
have no commit record). `seat_joined_at` identifies the sitting: every seating
path stamps a new `joined_at`; only the cash seat move and swap carry an old
`joined_at`, and they carry the seat's `club_id` in the same UPDATE. No writer
changes `table_seats.club_id` inside a sitting except filling a NULL
(`fn_heal_seat_provenance`), and a witness never carries NULL. So one
(player, table, `seat_joined_at`) has one club.

For a dealt-in player with no witness on the hand:

| step | rule name      | reads                                                                                                                                                                                                       |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `witness`      | the hand's own `rake_attributions` row (unchanged)                                                                                                                                                          |
| 2    | `receipt`      | the buy-in receipt whose `seat_joined_at` equals the hand's                                                                                                                                                 |
| 3    | `seat`         | the `table_seats` row whose `joined_at` equals the hand's                                                                                                                                                   |
| 4    | `same_sitting` | the player's own witness on the nearest earlier and nearest later hand at this table, each accepted only if that hand's commit shows the same `seat_joined_at`; if both exist and disagree, neither is used |
| 5    | `table_club`   | the table's club                                                                                                                                                                                            |

A hand with no commit record keeps the installed dated reads at steps 2-3
(`receipt_unbound`, `seat_unbound`) and has no step 4. No membership lookup
and no exit-record lookup remain.

## Per-rule counts (read-only)

The calculation moves verbatim into `fn_ca_club_rake_daily_parts(from, to, ids)`,
which returns every part with the rule that placed it (`whole_hand` for a hand
with no usable split, `table_drop_and_pot` for the table's bbj/pot row).
`fn_ca_club_rake_daily_compute` is now that function summed, so the totals are
the same rows by construction. `fn_ca_club_rake_daily_rule_counts(from, to)`
(window at most 31 days) sums it by day, club and rule; its hands add up to
the calculator's hands per club and day (asserted in the test). All three are
SECURITY DEFINER, STABLE, `search_path=public`, service_role only, owned by
postgres, and write nothing. No stored aggregate changes.

## How union accounting attributes the same hand

- **Invoices / fees.** The weekly accrual (`fn_accrue_cash_hand_commissions`,
  `fn_accounting_cash_commission_plan`) and `accounting_cash_rake_sources` are
  built only from raked hands, one row per paying player, from that player's
  `rake_attributions` row. Its club is `fn_cash_earning_club`: on a union table,
  the club of the `table_seats` row live at the hand's start (custody funding
  club for a retired hand; a Lightning hand's anchor seat or receipt), and it
  raises `cash_earning_seat_provenance_missing_or_ambiguous` rather than guess.
- **Union Club Data basis** (`ca_club_data_screen_union_basis` over
  `ca_club_acct_fact_ct`): the cash fee row's club is the funding contract's
  `funding_club_id`, else the source row's club, i.e. the same witness.
- **BBJ share** (20261115150131): the hand's `rake_attributions` club for the
  recipient, else the buy-in receipt at that table before the payout; never
  the table's club or a "home" club; with no member record the share parks.

Agreement: step 1 is the same witness, so rake and fee by club agree to the
cent. The hand count adds rows accounting never has - zero-contribution
players - and every one of steps 2-4 reads the same sitting that
`fn_cash_earning_club` would have read at the hand's start.

Difference: accounting never falls back to the table's club; it refuses or
parks. The hand count's step 5 credits the table's club, which on a union
table is the Midway Union house. That is table location, not ownership: the
3,189 such hands over 14 days were not shown to be played through the house.
Showing them as "unassigned" instead would match accounting; that is a
product decision left open (it needs a place in `ca_club_rake_daily`, which is
keyed by club).

## Effect on 14 closed days (read-only reconciliation; nothing written)

Stored `ca_club_rake_daily.hands` vs this rule recomputed inline on production,
2026-11-01..14. Rake, bbj and pot per club are unchanged by this rule (no
positive contribution lacked a witness in any window).

| Club                                   | Hands stored | Hands, this rule |   Change |
| -------------------------------------- | -----------: | ---------------: | -------: |
| Deep Stack Society                     |    1,124,139 |        1,125,663 |   +1,524 |
| The Felt Society                       |    1,117,937 |        1,129,392 |  +11,455 |
| KINGS CLUB                             |      442,439 |          174,129 | -268,310 |
| Midway Union (table club, no evidence) |            0 |            3,189 |   +3,189 |

Rules used over the 14 days (club-hands): witness 2,136,806; same_sitting
147,140; receipt 97,448; receipt_unbound 46,569 (hands before the commit
record existed); seat 1,166; seat_unbound 55; table_club 3,189.

## What is not done

No history is rebuilt; existing `ca_club_rake_daily` rows stay as written.
`fn_ca_club_rake_daily_rebuild_range` was not run. Recounting closed days is a
separate decision. No wallet, ledger, settlement, scheduler or live-game state
is touched.

## Proof

- `scripts/ci/test-club-data-report-db-postgres.py` (native PostgreSQL 17):
  the history scenario builds each case on union tables with hand commit
  records - a later hand of the same sitting, a re-sit through another club
  with no exit row (with and without a later witness), an exit row of a later
  sitting, a club changed mid-sitting, a receipt of an older sitting - and
  proves the installed calculator fails them (the first draft also failed
  them, run locally 2026-11-16), the new
  calculator passes, rake is unchanged, the per-rule parts are exactly the
  expected rules, and the rule counts add up to the calculator. It also proves
  a rolled-back or browser-role run installs nothing, the authority settings,
  the live proof, the replay refusal, and that a browser cannot read the counts.
- `tests/club-data-counts-what-the-club-played.law.test.ts` pins the order, the
  sitting binding, and that no `club_members`, `joined_at ASC` or
  `ca_seat_stack_exits` lookup is left in the calculator.
