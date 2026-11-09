# Horses Are Refunded Exactly As Humans (2026-11-08)

Dan, 2026-11-08, hard rule: "HORSES GET REFUNDED 100% OF THE TIME ... I DON'T KNOW WHO STARTED THIS, BUT HORSES GET REFUNDED EXACTLY THE SAME AS A HUMAN 100% OF THE TIME!" It supersedes the 2026-11-05 note "no refunds to horse entries or horse-only events", which he never ordered. Every other refund rule applies to a horse the same way: refund the actual eligible entry, subtract what was already refunded, send a union-promo-funded entry back to the union promo fund, keep an auditable record, never pay twice.

## What was found

Every refund, cancel, abort, void, retire, unregister and closure routine in production (public and smarter_private), every such migration, the engine (server/src), scripts, edge functions, CLAUDE.md, docs/laws.d and the runbooks were read for horse identity (is_horse, is_bot, horse_status, the fleet register, the horse email domains).

One place treated a horse differently with money: `smarter_private.owner_retirement_transfer_pools`, the money step of the Nov 2 owner retirement of the 140 frozen events (migration 20261102180105). It demanded a refund only for registrations where `NOT coalesce(p.is_horse,false)` and then moved everything else in the event, including the horses' own paid buy-ins, rebuys and add-ons, to Midway Main Bank. In the same event a human's charge was refunded and a horse's identical charge was swept to the house.

No code, runbook or law tells an agent to leave horses out of a refund. The 2026-11-05 note appears only in the owner's memory record (now corrected by the ruling). Engine code: every horse branch near a refund or cancel is identification or the horse's input device (rebuy/add-on candidates, mystery chest tap, seat-first human wait); none skips, reduces or redirects a return.

## Measured shortfall since 2026-10-01 (read only, production)

|                                                         | events | horse entries | horses | charges | chips         |
| ------------------------------------------------------- | ------ | ------------- | ------ | ------- | ------------- |
| Owner-retired chip events, horse charges never refunded | 114    | 1,827         | 856    | 2,220   | **17,931.00** |

- 113 events retired through the function on 2026-11-05 (17,657.00) plus Morning Free Buy d5decc98 (274.00), where the two humans' 1-chip add-ons were refunded by recorded owner credits and the 274 horse add-ons and rebuys were not.
- By kind: buy-ins 1,098, add-ons 997, rebuys 125. By club charged: Deep Stack Society 7,983.00, The Felt Society 5,725.00, KINGS CLUB 4,223.00.
- No human charge is outstanding in that set. None of the 2,220 is promo funded: every one is a player-wallet debit.
- Per entry, per event and per horse: docs/evidence/2026-11-08-horse-refund-parity/.
- Everything else matched: other cancelled chip events since Oct 1 refunded horses in full (4,861 charges, 83,862.50, 0 short; humans 96.00, 0 short); 41 cancelled Diamond events refunded horses 418,200 of 418,200; operator aborts refunded 73 horse lines in full.
- Diamonds, reported, not settled: the 15 retired Diamond events had 1,257 paid horse entries (394,320 diamonds paid in, 0 refunded), sent to KingFish; no human played them. Diamond Arena is permanently retired (Dan, 2026-11-05: "NO DIAMONDS OR CHIPS ANYWHERE"), so whether those come back to the horses is the owner's call.

## What changed

Migration 20261108215333:

1. `owner_retirement_transfer_pools` no longer reads horse identity. Custody cannot move while any paid wallet charge in the event is unrefunded, whoever paid it. Byte-exact preimage asserted; nothing else in it changed.
2. `smarter_private.horse_refund_parity_receipts`: one immutable row per refunded entitlement (the primary key is the entitlement).
3. `smarter_private.horse_refund_parity_back_refund(n)`: the back-refund, installed and not run. The coordinator runs it (scripts/operations/horse-refund-parity-20261108-back-refund.sql). The events are sealed, so it uses the audited house door of the 2026-11-07 make-goods: a 10.9 adjustment citing the ruling, a declared union_bank journal leg, Midway Main Bank (which received the retired custody) debited, and the paid entry credited to the exact club wallet charged. It re-proves each original debit, subtracts anything already refunded, refuses a non-player-wallet source, and runs at most 10 charges per call outside the hourly break and any freeze. 609 of the charges (4,445.00) land on horse records the Nov 2 club split departed; the existing club-split trigger then moves them to that club's bank, as it does with every late credit (Dan's Nov 2/3 order).

Law: tests/a-refund-never-reads-horse-identity.law.test.ts. No money-return routine defined since 2026-11-02 may read horse identity. It fails on main without this migration.

Proof: scripts/ci/test-horse-refund-parity.py runs the exact bytes over the captured production preimage and the pinned production rows. It covers the defect, the fix, the refusals, all 2,220 refunds conserved to the chip, and the replay.
