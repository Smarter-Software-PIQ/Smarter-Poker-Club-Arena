# A jackpot share follows the hand's club (2026-11-15)

Owner rule (2026-11-15): a player can play in several clubs; each club's numbers
reflect only the hands played through that club, and nothing is excluded because
a player belongs to several clubs.

## The defect, read from rows

`bbj_credit_one_recipient` paid a departed recipient's Bad Beat Jackpot share to:
the latest `table_seats` row's club only while that membership was active; else
`tables.club_id` (the union house club on a union table); else
`fn_player_home_club` (the club holding the player's largest balance). Seat rows
are deleted when a player leaves, so the first step almost never answered.

Midway Union, shares paid since 2026-10-15: 218 wallet shares; 28 of them
(8,663.26, every recipient a horse) went to a club other than the one the hand's
own `rake_attributions` row names (earning club -> wallet credited):

| Week (Mon 2 AM Chicago) | Felt -> Union house | KINGS -> Union house | Felt -> KINGS | KINGS -> Felt |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-19 | 5,622.29 | 203.12 | 26.56 | |
| 2026-10-26 | 1,424.82 | 261.45 | 806.26 | 106.25 |
| 2026-11-02 | | 212.51 | | |

`fn_union_pnl_week_bbj_stack_awards` then attributed each wallet share to the
wallet's club, so the wrong club's statement carried it (all of union house
statement MIDWAY-2026-000040's players_won, 212.51, belongs to KINGS 000039).

## The fix (`20261115150131_a_jackpot_share_follows_the_hand_club.sql`)

1. The credit resolves the club from the hand: the hand's rake attribution for
   the recipient (written before the payout in 271 of 271 measured shares), else
   the cash buy-in receipt that funded the recipient's seat at that table before
   the payout. It credits that club's retained member record whatever its
   status; with no record the share parks exactly as before. The table-club and
   home-club fallbacks are gone.
2. The weekly award reader attributes a wallet share to the hand's earning club,
   falling back to the wallet's club only where the hand left no attribution.
3. `original_inventory_proof_sources_match` follows the reader's new md5.

Rolled-back probe on production (pg_temp copies of both patched bodies, one DO
block ending in RAISE): both compiled; the week of 2026-10-19 moved from
Felt 10,967.60 / KINGS 25,008.44 / house 7,951.35 to 16,616.45 / 25,185.00 /
2,125.94 (Deep Stack unchanged), and the week of 2026-11-02 moved 212.51 from
the house to KINGS - exactly the audited amounts.

Pinned by `tests/a-jackpot-share-follows-the-hand-club.law.test.ts`.

## The 28 past shares

The chips cannot be moved back: 27 of the 28 wrong wallets no longer hold the
share (moving it would take chips from a player, CLAUDE.md 10.9 rule 3), and the
remaining one (106.25, Felt wallet, earned in KINGS) would move chips into a
suspended membership. The wallets are left as they are.

The statements are corrected through the union's own credit-note path
(`fn_union_issue_credit_note`, `adjusts_invoice_id`) by
`docs/changelog/2026-11-15-union-statements-are-delivered-and-owe-what-they-say.md`.
