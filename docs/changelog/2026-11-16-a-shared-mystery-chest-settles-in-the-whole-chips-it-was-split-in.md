# 2026-11-16 - A Shared Mystery Chest Settles In The Whole Chips It Was Split In

Incidents `32401e24` (TournamentBountyRecoveryLaneFailing), `2df6b652` (TournamentBountyOutboxBacklogStuck) and `53d8ad77` (fn_ca_bust_backlog_page) fired between 04:27 and 04:34 UTC on 2026-11-16. They were all one fault, in the Prime Time Free Buy (NLH) mystery bounty event `6b80eaac`.

## What happened

At 04:24:19 UTC a split-pot knockout shared an 11-chip mystery chest (award `7580c5ae`, obligation `2ebe8562`) between two players. `fn_mystery_bounty_reserve` wrote the split as 6 + 5 chips. This is the whole-chip cut Dan ruled on 2026-10-22 ("a shared chest divides in whole chips"), installed by `20261022170421` as `GREATEST(100, fn_ca_tournament_unit_cents(...))`.

That migration did not change `fn_bounty_obligation_has_complete_marker`, the proof that a knockout obligation was paid exactly. The proof still expected the split at the money unit, one cent for a chip event, so it wanted 5.50 + 5.50. `fn_mystery_bounty_pay` paid both players, found the proof false, raised `mystery award ... completed without its exact settled marker`, and rolled the whole payment back. It did this correctly every time, and so it did it forever: 23 attempts by 04:41.

One stuck obligation caused all three alerts:

- the bounty recovery lane failed on every retry (TournamentBountyRecoveryLaneFailing);
- the outbox held an unsettled obligation (TournamentBountyOutboxBacklogStuck);
- every later bust in the event waits for its tournament's bounty lane, so busts stopped being recorded. The backlog reached 40, and their chairs read "playing at zero chips", so `f06_movement_prior` refused every table break (fn_ca_bust_backlog_page).

It hid for three weeks because the writer and the proof agree whenever a chest divides evenly in whole chips. The only other shared chest since 10-22, 38 chips between 2 players on 11-05, did divide evenly.

## The fix

`20261116044125_a_shared_mystery_chest_settles_in_its_whole_chip_split.sql` changes the mystery-chest branch of the proof. It now accepts a split that exactly matches one of two canonical cuts, claimant by claimant:

- the whole-chip cut the current writer makes;
- the money-unit cut the writer made before 2026-10-22, so every chest settled under the old rule still proves.

Any other split still fails. For a Diamond event the two cuts are the same unit. The regular/PKO branch is unchanged, because `fn_collect_bounty` still pays heads at the money unit.

The fix went to the proof and not the writer because whole-chip shares are the owner's rule and match the no-decimals display rule. Moving the writer back to cents would have paid 5.50 chips.

## Delivery

The fix went in as an active-outage direct apply (CLAUDE.md section 2, rule 11), because a live event could not break tables, and this PR is the byte-exact recording. The statement's md5 in `schema_migrations` is `9a0873e9cb36e6800c9436bd7dd76c6f`, the same as the file.

Production holds the row under the same version with the longer name `a_shared_mystery_chest_settles_in_the_whole_chips_it_was_split_in`. That name is 65 characters, over the repository's 60-character limit, so the file carries a shorter name under the same version. The applier and the recorded-migration gate both match on the version first.

Before installing, a `pg_temp` copy of the new body ran against production:

- obligation `2ebe8562` proves once paid;
- all 2,555 settled `mystery_chest` obligations prove under both the old and the new body, with 0 regressions.

The migration repeats that check as its own post-condition.

## Verified live

- 04:41:25 UTC: installed.
- 04:42:27 UTC: obligation `2ebe8562` settled on the first retry after install. Award completed; recipients paid 6.00 and 5.00 chips through `fn_settle_tournament_obligation`. No duplicate was possible, because each failed attempt had rolled back in full.
- 04:42:51 UTC: bust recording resumed, and the backlog drained from 40.

## Pinned

`tests/a-shared-mystery-chest-settles-in-the-whole-chips-it-was-split-in.law.test.ts` (registry: `docs/laws.d/a-shared-mystery-chest-settles-in-the-whole-chips-it-was-split-in.md`) ties the two functions together. The newest reserve writer must cut in whole chips, and the newest proof must accept exactly that cut and the pre-10-22 cut. A change to either side without the other turns it red.
