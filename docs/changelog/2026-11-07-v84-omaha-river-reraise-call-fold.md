# V84: a horse that bet the river folds a second-nut flush to a pot-sized raise (2026-11-07)

## The hand

`horse_hand_reviews.id` 3359656 (hand `f0e3c1b4-f1cc-4948-ab72-cc9f78b79dd3`),
PLO6 tournament, 7 seats dealt, big blind 25. The horse held
4d Jc Ks Qh 5d Kd on 9d 7d 2d 4s 6s: a king-high flush with the Ad live. It
bet 2,858 into 4,090, the villain raised to 12,664 (1.82 pot by the V81
measure), and the horse called 9,806 and lost 587bb.

V81 (`HorseOmahaBigBetCalls.ts`) never looked at this spot: it covers PLO4
and PLO5 only, and it leaves out any horse that already has chips in the
street (bet, then raised). This is the nut-awareness gap on the call side.

## Measurement

Same method and admission rule as V81, new read-only template
`scripts/horse-measure/sql/omaha-river-reraise-calls.sql`
(`horse-release-verify.py sql omaha-river-reraise-calls START END`), cells by
`scripts/horse-measure/omaha-call-cells.ts`, which now also reads hole cards
as a compact string.

- Population: every horse PLO4/PLO5/PLO6 river CALL (or all-in that only
  calls) of a raise, made after the same horse bet or raised that river.
- Source: `ca_hand_facts` joined to `hand_history` (the source V81 used).
  Coverage measured on 2026-11-06 04:00 to 06:00 UTC: 34,025 PLO4/5/6 hands
  in `hand_history`, 34,025 in `ca_hand_facts` (100%), 560 in
  `horse_hand_reviews` (1.6%). `horse_hand_reviews` is a small sample and was
  not used for the measurement.
- EV: the call's value against folding, (net + chips already invested at the
  node) / bb; 95% CIs clustered by hand. Hand classified at the decision with
  `omahaCallClass`; wager measured as `v81StreetWager` does (chips the raiser
  added over the pot just before the raise). Excluded as in V81: heads-up
  tables, bounty events, 20bb effective or less.
- Days: A 2026-11-05 16:00 to 11-06 16:00 UTC, B 11-06 16:00 to 11-07 16:00
  UTC. Raise >= 0.9 pot: 71 calls on day A, 157 on day B.

Per cell, all slices pooled, mean bb [95% CI] n:

| cell                    | day A                       | day B                      |
| ----------------------- | --------------------------- | -------------------------- |
| flush_second (unpaired) | -100.8 [-159.5, -42.0] n 12 | -93.0 [-130.3, -55.6] n 15 |
| flush_second_paired     | -43.0 [-58.9, -27.2] n 2    | -54.2 [-88.3, -20.1] n 4   |
| flush_nut_paired        | -28.3 n 1                   | -78.1 [-130.6, -25.7] n 6  |
| flush_nut               | +55.2 n 1                   | -109.5 n 1                 |
| flush_dominated         | none                        | +205.5 [-33.9, 444.9] n 3  |
| straight_flushboard     | +15.1 [-101.0, 131.1] n 2   | -70.8 [-96.6, -44.9] n 8   |
| straight_nonnut         | -59.8 [-102.3, -17.3] n 3   | -2.0 [-99.4, 95.4] n 10    |
| straight_paired         | -35.6 [-81.5, 10.5] n 2     | -33.9 [-45.1, -22.8] n 3   |
| straight_nut            | +88.7 [63.9, 113.6] n 19    | +166.8 [135.5, 198.2] n 50 |
| two_pair                | -20.6 [-64.9, 23.7] n 3     | -48.1 [-61.3, -34.9] n 8   |
| trips / sets            | -111.4 n 1                  | +170.0 [-55.0, 394.9] n 4  |
| full_house_plus         | +58.5 [-3.8, 120.8] n 25    | +73.0 [5.1, 140.9] n 43    |
| one_pair                | none                        | -119.9 n 1                 |

Second-nut flush slices (day A / day B): PLO4 -76.8 n 5 / -99.0 n 12, PLO5
-113.0 n 2 / -72.9 n 2, PLO6 -119.8 n 5 / -60.5 n 1, cash -79.1 n 9 / -93.0
n 15, tournament -165.8 n 3 / none. Every one of the 27 calls lost. Full
per-slice output (variant, format, heads-up or multiway at the node):
`docs/horse-measure/2026-11-07/v84-river-reraise-cells.txt`; raw rows in
`docs/horse-measure/2026-11-07/v84-river-reraise-calls/`.

## Admission

V81's rule: below zero on both days and no variant or format slice with
n >= 10 positive on either day. One floor added: at least 10 hands in the
cell on each day, because a CI from two to four hands is not evidence.

- Admitted: the unpaired-board second-nut flush, PLO4, PLO5 and PLO6, cash
  and tournament. Hand 3359656 is in this cell.
- Not admitted: the paired-board second-nut flush and the paired-board nut
  flush (below zero, but 2 to 6 hands a day), two pair and the flush-board,
  non-nut and paired-board straights (each straddles zero on one day), and
  everything that wins (nut straights, full houses). They should be
  re-measured once more days accumulate.

## Engine change

- `HorseOmahaBigBetCalls.ts`: `v84Cell`, `v84HeroWageredStreet`,
  `V84_VARIANTS`, with the evidence in the V84 header.
- `HorseLogic.ts`: `omahaBigBetCallFold` now evaluates V81 and V84 from one
  shared reading of the wager (they are disjoint: V81 needs no chips of the
  horse's in the street, V84 needs its own bet or raise). New option
  `v84OmahaRiverReraiseCalls` (default on; explicit false keeps today). The
  V81 switch does not affect V84. Receipt `v84_omaha_river_reraise_call_fold`.
- Registered in `HorseDataLedger.ts` (flag and receipt), the activation
  receipt list (`scripts/horse-measure/sql/activation.sql`), the reference
  decision sources note, and the neutrality corpus off arms.
- Law: `server/src/engine/HorseOmahaRiverReraiseCalls.law.test.ts`
  (`docs/laws.d/omaha-river-reraise-calls-fold-in-measured-cell.md`): end to
  end over many seeds in every variant and format, the hand 3359656 scenario,
  the off arm, cells outside unchanged, label flips.

## Limits

Only the horses' own calls are observed (no counterfactual fold policy), ICM
is not modelled, and a raiser MEASURED as a postflop over-bluffer keeps
today's call as in V81. The measurement ran on the current engine, after V81.

## Denominator, chops and pot odds, re-measured before activation (2026-11-07)

The owner asked, before the 04:00 Chicago activation, for the complete
eligible-opportunity denominator, the sizing and pot-odds evidence, proof that
the 27 losses are all the qualifying outcomes, correct chop handling, and
focused boundary checks. Evidence:
`docs/horse-measure/2026-11-07/v84-river-reraise-denominator.txt`, produced by
the new read-only template `scripts/horse-measure/sql/omaha-river-reraise-opportunities.sql`
(every action, every exclusion kept as a column) and
`scripts/horse-measure/omaha-river-reraise-denominator.ts`.

- **Denominator.** Same two days and eligibility. The horses met the spot with
  an unpaired second-nut flush 49 times and called all 49: no fold, no
  re-raise. 22 fell to the V81 exclusions (14 raises under 0.9 pot, 4 heads-up
  tables, 2 bounty events, 2 at 20bb or less), leaving exactly the 27 calls of
  the first pull, matched hand for hand on full ids.
- **Nothing dropped.** No 8-character id collision (222 decisions, 222
  prefixes); a direct `hand_history` scan of two six-hour windows found every
  qualifying decision in `ca_hand_facts` (94 and 202, none missing); no
  run-it-twice; the only two-board or bomb-pot decisions were double-board
  bomb pots, which V84 excludes; none of the 27 was on an all-in-or-fold
  table; six faced an all-in raiser and are counted, as `v81StreetWager`
  counts a raising all-in.
- **Chops.** The EV is (net + chips in at the node) / bb with
  `net = returned - invested`, so a split pot counts at its fractional
  return. None of the 49 was a chop. Every showdown was a nut flush or a
  straight flush.
- **Pot odds.** Price = call (capped at the stack) / (pot + call), the
  equity the call needs: 0.028 to 0.333, median 0.333. 0 wins in 27 bounds
  the true win rate at 0.105 (one-sided 95%; Clopper-Pearson two-sided 0.128).
  Four calls needed less than that (0.028, 0.048, 0.066, 0.096: a horse all
  in for its last few chips), so the evidence does not show they lose.

**Decision.** The cell still passes the admission rule. One boundary is
added from the pot-odds evidence: V84 folds only a call priced at
`V84_MIN_CALL_PRICE` = 0.13 or more. Those 23 calls all lost: day A -106.5
[-169.6, -43.3] n 11, day B -101.8 [-145.2, -58.3] n 12, and 0/23 bounds the
win rate at 0.122, below every price in the set. A cheaper call keeps today's
answer. All-in-or-fold tables, never observed in this spot, are excluded too.
Hand 3359656 (price 0.333) still folds.

New boundary checks in `HorseOmahaRiverReraiseCalls.law.test.ts`, end to end
against the off arm: a raise of exactly 0.9 pot folds and 0.883 keeps today;
a horse that only called earlier on the river is out; paired board, nut flush
and heads-up table keep today; an all-in raise for less than a full raise
folds; an all-in call folds legally; a call priced 0.031 keeps today; all-in-
or-fold, hi-lo, multi-board and bomb pots keep today; a raiser measured as a
postflop over-bluffer keeps today.
