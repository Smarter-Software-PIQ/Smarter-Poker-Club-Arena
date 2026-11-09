# 2026-11-08: the opener facing an all-in 3-bet, and the 3-bettor facing a 4-bet

Owner report (Dan, 2026-11-08): "A LOT OF TIMES WHEN A HORSE OPENS, AND A
HUMAN 3 BETS, OR 4 BETS IT SEEMS LIKE THEY ALMOST ALWAYS FOLD."

## What was measured (release 391f7bc0, hand_history publicNode, read only)

Spot A: a horse made the first raise, one opponent re-raised, nobody called
in between; hero's first answer. Spot B: a horse 3-bet and faced a 4-bet.
Counts are fold / call / raise.

| cell                                               | window (UTC)            | F / C / R      | fold % | mean MDF |
| -------------------------------------------------- | ----------------------- | -------------- | ------ | -------- |
| A tournament NLH heads-up, 12-25bb                 | 11-08 01:20-05:20       | 896 / 72 / 34  | 89.4   | 0.30     |
| A tournament NLH 3-6 handed, 12-25bb               | 11-08 01:20-05:20       | 628 / 34 / 27  | 91.1   | 0.26     |
| A tournament NLH heads-up, 12-25bb, 3-bet ALL IN   | 11-07 23:20-11-08 01:20 | 242 / 3 / 8    | 95.6   | 0.19     |
| A tournament NLH 3-6 handed, 12-25bb, 3-bet ALL IN | same                    | 165 / 3 / 5    | 95.4   | 0.20     |
| A cash NLH 3-6 handed, 100bb+                      | 11-08 01:20-05:20       | 545 / 442 / 65 | 51.8   | 0.31     |
| B cash NLH 3-6 handed, 100bb+                      | same                    | 65 / 2 / 14    | 80.2   | 0.41     |

The cash 3-bet cell sits on the V73 reference (a late opener folds about
half its open). The short tournament cells and the cash 4-bet cell fold far
past both MDF and the V73 target. Every one of those folds carried origin
`horse_policy` (no fallback, clock or refusal).

## The two defects, from replay

Each hand was replayed with the complaint kit (HorseComplaintReplay,
`horse-complaint-replay.ts`) through the real `HorseLogic.decide`.

1. **The 3-bet node's stack cap vetoed every call of an all-in 3-bet.**
   `capOK3 = toCall <= stack * 0.35 || (investedShare >= 0.1 && guardOdds <= 0.45)`
   in HorsePreflop. A 2-2.5bb open has invested about 10% of a 20bb stack and
   less of anything deeper, so any jam over the open fails both arms and the
   hand folds whatever the strength bar says. Replayed folds: QQ (7ee5da8f,
   22bb jam, 43% to call), JJ (07bf481d), TT (b6d4d909, c7e8745c, 604ecd40,
   9a345faa), AKo (f389f740, fdd3e803, ea7ebd51), KQs, 99. The cap exists to
   stop a light call being followed by more betting; a call that closes an
   all-in has nothing after it.
2. **Facing a 4-bet, style tightness put the call and jam bars out of reach.**
   `t53(0.95 + deepT)` and `t53(0.88 + deepT)` multiply the style tightness;
   the live cash Hybrid is Grinder (tightness 1.0976), so both bars landed
   on BAR_CAP 0.965 and only AA continued. Replayed folds: KK (d481b609,
   121bb, 9.5bb to call into 25bb), QQ (cea123e5), AKo (5bf00645).

## The fix

- `facingClosedAllIn` (HorseLogic -> HorsePreflop ctx, default on, explicit
  false is the ablation arm): the last raise is all in and every other live
  opponent is all in or folded. Then neither the 35% cap (3-bet node) nor
  the 30% cap (4-bet node) vetoes a call the strength bar makes. Hold'em only.
- Facing a 4-bet (hold'em), the tightness multiplier is `min(1, tightness)`:
  a tighter style may loosen these bars, never push them past the balanced
  line. ICM premium and the V21 deep scale are unchanged.
- Neither path reads player identity; the trigger is public seat flags.

After the fix the live profiles call or jam QQ, JJ, TT, AK, KQs and 99 in the
replays above and call/jam KK, QQ, AKo facing the cash 4-bet. Hands that the
strength bar itself folds still fold (88 facing a 20bb jam nine-handed, AQo
facing a sized 3-bet under the gun at 55bb, JJ/TT facing a sized 4-bet 200bb
deep); those follow the documented V73 and V21 contracts.

## Not changed, still out of line (follow-ups)

- V73 is skipped when the 3-bettor is all in (`reRaiser.is_all_in`) and below
  25bb (`vs3BetShortStack`, off), so short all-in 3-bets read the fixed
  legacy bar. Heads-up tournament openers facing a small, not-all-in 3-bet at
  12-25bb still folded 173 of 199 (11-07 23:20-01:20). That needs a priced
  short-stack vs-3-bet read with league evidence, not a cap change.
- `vs3BetShortStack` stays OFF and unchanged by this PR. Its qualification gap
  is the one recorded in docs/changelog/2026-11-07-horse-preflop-defence-leaks.md:
  the league `vs3bet_short_stack` card had one human-calibrated seed below
  -2 standard errors. It needs a fresh held-out league result with every seed
  non-negative before it may be switched on.

## Multiway: the exception never applies while another player can still bet

`facingClosedAllInRaise` (HorseLogic.ts) is a pure function of public seat
flags. It is true only when the raise is all in AND every other player still
in the hand is all in or folded. A cold caller with chips behind, or a blind
still to act, keeps it undefined and the caps apply exactly as before.
`HorseFacingClosedAllIn.test.ts` pins the predicate on heads-up, multiway
folded, multiway all-in, cold-caller and blind-to-act seats. It also re-plays
the real QQ hand with the small blind calling the jam and keeping 804 behind.
There the cap still applies and the result equals the flag-off arm.

## Pinned

`server/src/engine/horseComplaints/qq-opener-folds-to-an-all-in-3-bet.law.test.ts`,
`tt-heads-up-opener-folds-to-an-all-in-3-bet.law.test.ts` (both with the
`facingClosedAllIn=false` control re-taking the fold) and
`kk-three-bettor-folds-to-a-4-bet.law.test.ts`, plus
`server/src/engine/HorseFacingClosedAllIn.test.ts` (multiway).

## Review changes (independent review, 2026-11-09)

- **Depth bound.** The exception applies only at an effective stack of 40bb or
  less (`CLOSED_ALL_IN_MAX_EFFECTIVE_BB`). The measured defect was 12-25bb.
  Deeper, the 35% cap is what keeps a style from stacking off light: without
  the bound the cash hybrid called a 100bb jam with JJ, TT and AQo, and LAG
  called a 200bb jam with KQs, ATs, 99 and AQo.
  `HorseFacingClosedAllIn.test.ts` re-plays the real TT hand rescaled:
  - at 100bb the result equals the flag-off arm for every profile, and this
    test fails if the bound is removed;
  - at 30bb the exception changes the decision.
- **Scope.** The exception and the 4-bet-node tightness clamp are limited to
  no-limit hold'em (not fixed limit, not short deck). That is where they were
  measured.
- **Sitting-out seats.** A seat sitting out is not dealt and cannot bet, so it
  no longer keeps the exception off. This is the same rule as `oppsLeft`.
