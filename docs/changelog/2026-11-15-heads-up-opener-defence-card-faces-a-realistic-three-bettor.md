# Heads-up opener defence card faces a realistic 3-bettor (the every-hand card was inert)

Date: 2026-11-15. Lane: heads-up, round 2. Status: league card change only. No decision changes, no option default
changes, no schema change, no migration. `huOpenerDefendsToPrice` stays default OFF and is not proposed for
activation.

## What was wrong

The nightly league of 2026-11-15 (engine 54c9aac8) ran `human_hu_opener_defends_vs_threebet_40bb` and wrote status
`inert`: 0 of 12,000 pairs diverged, both arms +123.90 bb/100. The card dealt the option against the
`hu_three_bet_every_hand_v1` persona, which re-raises every open. Against that player the engaged opponent read
already decides the opener's answer, so the option never changed a decision. No test dealt a persona card and looked
for divergence, so nothing caught it before the nightly did.

Probes on b262fd3e0 (real `runMatchup`):

| Card as it was                           | Seed                    | Pairs | Divergent pairs |
| ---------------------------------------- | ----------------------- | ----- | --------------- |
| every-hand 3-bettor, reads on            | 2026-11-15 nightly seed | 2,000 | 0               |
| every-hand 3-bettor, reads on            | 20261115                | 4,000 | 1               |
| every-hand 3-bettor, memory learning off | 2026-11-15 nightly seed | 4,000 | 82              |

So the read, not the spot, stands the option aside.

## What changed

- `server/src/benchmark/HorseLeague.ts`: the opener card of `HU_DEFENCE_CARDS` is now
  `human_hu_opener_defends_vs_wide_40bb`, the same arms, 40bb, live cash Hybrid persona and deal-seeded mood clock,
  against `hu_wide_sb_aggressor_v1`, whose big blind 3-bets light but not every hand (a 3-bettor inside the
  realistic band, the opponent the option exists for). No new persona was needed.
- The old card is retired, not deleted: `human_hu_opener_defends_vs_threebet_40bb` moves to `UNMEASURABLE_MATCHUPS`
  with its measurements and what would change the verdict, so every run writes a refused row the audit reads.
- `huLimpDefendsToPrice`'s card (`human_hu_limp_defends_vs_minraise_40bb`) measured +4.66 +/- 5.47 on 2026-11-15 and
  is unchanged.
- Tests: `HorseLeagueHumanField.test.ts` names the new card, deals both defence cards at 1,500 pairs (seed 4242) and
  requires divergence, and requires the retired card to be refused with its reason;
  `LeagueInertMatchupsAreRetiredOrRepointed.test.ts` lists the retired name. The pointers in the option's comment
  (HorseLogic.ts) and ledger note (HorseDataLedger.ts) name the new card.

## Proof (local, real runMatchup, b262fd3e0 plus this change)

| Card                                   | Seed                    | Pairs  | Divergent pairs | Inert | A minus B, bb/100 |
| -------------------------------------- | ----------------------- | ------ | --------------- | ----- | ----------------- |
| human_hu_opener_defends_vs_wide_40bb   | 2026-11-16 nightly seed | 12,000 | 303             | false | -2.26 +/- 2.71    |
| human_hu_opener_defends_vs_wide_40bb   | 2026-11-15 nightly seed | 3,000  | 83              | false | +6.13 +/- 6.25    |
| human_hu_opener_defends_vs_wide_40bb   | 4242                    | 1,500  | 40              | false | -8.91 +/- 10.26   |
| human_hu_limp_defends_vs_minraise_40bb | 4242                    | 1,500  | 209             | false | +28.90 +/- 16.66  |

0 illegal actions and 0 truncated streets in every run. These are divergence proofs, not an evaluation of the
option; the declared evaluation is evaluation/RESULTS-HU-DEFENCE.md (wide persona 40bb: +4.75 +/- 1.29 over 100,000
hands on the option's source of 2026-11-14).
