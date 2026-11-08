# Nash push/fold V2: the call of a jam, ten-handed seats and ICM (2026-11-07)

Options: `nashCallVsJam` (default ON, explicit `false` keeps the strength
bar) and `nashPushFoldIcm` (default OFF, explicit `true` turns it on), both
registered in `HorseDataLedger.ts`; receipt `nash_call_vs_jam`.

## The defect, measured

The preflop audit (`HorseLogic.decide` at constructed nodes, built the way
`benchmark/HorseLeague.ts` builds a hand; live Hybrid personas for cash and
tournament; worker feature flags as the live worker admits them; the
production `memory_charts_gold` rows hydrated, so the charts answer exactly
as they do live; 24 samples per class) found the call of an open-jam read a
strength bar that did not look at the jammer's seat, the dead money or the
depth. Combo-weighted call share of the big blind:

| spot (folded to the jammer)           | horse today | Nash table (= flag on) |
| ------------------------------------- | ----------- | ---------------------- |
| cash 6-max 20bb, BTN jams             | 9.8         | 11.5                   |
| cash 6-max 10bb, BTN jams             | 5.2         | 23.1                   |
| cash 9-max 10bb, UTG jams             | 3.1         | 6.3                    |
| tournament 6-max 20bb (BBA), BTN jams | 6.3         | 19.6 (BB 19bb)         |
| tournament 6-max 10bb (BBA), BTN jams | 6.3         | 38.2 (BB 9bb)          |
| tournament 9-max 10bb (BBA), UTG jams | 4.5         | 17.0                   |
| tournament 9-max 20bb (BBA), UTG jams | 7.6         | 5.6                    |

Only the big blind against a small-blind jam had a chart (`sb_push`, the
no-ante game). V71's own changelog listed this as follow-up 2.

## The fix (root)

`server/scripts/nash-push-fold/solve.py --v2` re-solves the V71 game (chip-EV
jam-or-fold, first caller only, exact hero/caller card removal, the same
`equity169.tsv`, sha256 `fcf5a3cd...719e`) and keeps the callers' side of the
equilibrium that `solve()` computes every round and threw away:

- per (players behind the jammer 1..9, dead ante 0/1/2bb, bubble factor
  1/1.5/2/3): each class's "jams up to X bb" and "calls up to X bb" for an
  unposted seat, the small blind and the big blind, on the V71 0.5bb grid;
- bubble factor 1 reproduces V71's table exactly (4,056 of 4,056 thresholds,
  checked by test), and nine behind is a ten-handed under-the-gun seat;
- B > 1 is hero's best response with its chip losses weighted B times its
  gains (the standard push/fold reading of ICM) against the chip-EV
  equilibrium of everyone else, so it only ever tightens hero.

`to-ts-v2.mjs` wraps it as `server/src/engine/HorseNashPushFoldV2.data.ts`
(one character per class, 81 KB; data sha256 recorded in the PR) and
`HorseNashPushFoldV2.ts` reads it (bilinear across ante and bubble factor,
the V71 half-blind mix between grid points).

`HorseLogic`:

- **nashCallVsJam**: hero folded to a lone open-jam (the first and only
  raise, all in, nobody has called), <= 20bb effective (the smaller of the
  jam and hero's whole stack), no-limit hold'em two cards, no straddle, not
  all-in-or-fold: call or fold from the caller table by the jammer's dealt-in
  players behind, hero's caller kind, depth and dead ante. A maniac's jam
  stays with the maniac pricing. The big blind against a small-blind jam
  with no dead money stays with the `sb_push` chart, the same game solved for
  that spot. Tournament attribution reads it as the solver call-off it is
  (`chart_bb_defend`), as V71 reads its jam as `chart_open_jam`.
- **nashPushFoldIcm** (default off): in a tournament the V71 jam and the call
  above read hero's bubble factor (`IcmModel.bubbleFactor` on the same V16
  real-ICM inputs `icmRisk` prices; the input assembly is now one function,
  `realIcmInputs`, shared by both), and the V71 jam reads nine behind exactly.
  With bubble factor 1 and <= 8 behind it is V71 exactly.

## League (paired deals, `server/benchmark` `runMatchup`, 20,000 pairs, charts hydrated)

Mirror, live Hybrid persona, deal-seeded mood clock; a = `nashCallVsJam:
true`, b = off (the old strength bar). MTT cards play 180 left / 30 paid with
a 1bb big-blind ante.

| card               | seed 1107      | seed 2207      |
| ------------------ | -------------- | -------------- |
| MTT 6-max 10bb     | +4.72 +/- 0.64 | +3.41 +/- 0.63 |
| MTT 6-max 15bb     | +2.40 +/- 0.68 | +2.17 +/- 0.68 |
| MTT 6-max 20bb     | -0.08 +/- 0.63 | +0.55 +/- 0.63 |
| MTT 9-max 12bb     | +1.82 +/- 0.42 | +2.23 +/- 0.44 |
| MTT 9-max 20bb     | +0.62 +/- 0.45 | +0.17 +/- 0.45 |
| MTT heads-up 12bb  | +4.86 +/- 1.17 | +3.89 +/- 1.16 |
| cash 6-max 12bb    | +0.80 +/- 0.38 | +0.78 +/- 0.39 |
| cash 6-max 20bb    | inert          | inert          |
| cash heads-up 20bb | inert          | inert          |

Human-calibrated field (six-max, 10/15/20bb MTT): inert on both seeds (0
divergent pairs). That population sizes every raise and never open-jams, so
it cannot price a call of one. Nothing is below -2 stderr; every 10-15bb card
is above +2 stderr on both seeds, so the flag ships ON (owner rule).

`nashPushFoldIcm` ships OFF: the league's tournament contexts carry no stack
vector, so hero's bubble factor is 1 and the flag only moves ten-handed seats
(no ten-handed card exists). It is pinned by scenario tests.

## Tests

`server/src/engine/HorseNashPushFoldV2.test.ts`: the table reproduces V71;
heads-up call widths; tighter with more behind the jammer, wider with dead
ante and shallower; a bubble factor only tightens; premiums call, trash
never; ten-handed reads nine behind. Through `HorseLogic.decide`: the cash
and tournament big blind, the small blind and an unposted seat call the
table's width; on by default, explicit off keeps the bar; a called jam and a
30bb jam untouched; the no-ante small-blind jam stays with the chart; an
all-human table gets the calls an all-horse table gets; on a bubble the call
and the V71 jam tighten with the ICM flag; without stacks the ICM flag is chip
EV exactly.

## Follow-ups (reported, not changed)

1. The human-calibrated population never open-jams, so no human-field card
   can measure a call of a jam; a population that jams would.
2. The first-caller-only model runs slightly wide for an early caller (it
   ignores overcallers behind); the classic charts share that approximation.
3. `nashPushFoldIcm` needs a league context with a live stack vector before
   it can be measured.
