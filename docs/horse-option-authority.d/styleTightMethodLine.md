# styleTightMethodLine: authority for the live switch

**State: OFF in source (read `=== true`), switchable (`HorseOptionSwitch.ts`), no switch row in production. Do not switch on.** Evidence NOT MET: mechanism, scope, receipts, unit tests, and byte-identical off behavior are proven, and no harm was observed, but all three 3-seed paired league evaluations (`72,000` hands total on top of the live 67-row production switch) were completely inert (`0` divergent pairs, `0` fires), and the AsOf-memory HVH48-D audited replay (`2,734` of `3,891` decisions over `76,098` history hands) fired `style_tight_method_line_seen` on `6` nodes and changed `0` actions or sizes (`fixed 0`, `newlyWrong 0`, `changed 0`).

Companion default-on tracker: [docs/horse-default-on.d/styleTightMethodLine.md](../horse-default-on.d/styleTightMethodLine.md). Class definition: `docs/changelog/2026-11-16-tight-at-the-observation-line.md` (Hold'em Strategy lane, 2026-11-16).

## What it does

Source: `server/src/engine/HorseOpponentStyle.ts` (`TIGHT_METHOD_LINE`, `tightMethodLineRead`, `classifyOpponentStyle`), `server/src/engine/HorseMind.ts` (`styleReadUntimed`), `server/src/engine/HorseLogic.ts` (`prepareOriginalReads`), `server/src/engine/HorseDataLedger.ts`, `server/src/engine/HorseOptionSwitch.ts`.

In `classifyOpponentStyle`, when every earlier participation route (base VPIP/call-share test and `styleTightMultiSignal` if active) leaves the opponent's participation axis `neutral`, `opts.styleTightMethodLine === true` admits the observation-method tight line for no-limit hold'em (`family === 'holdem'`, `variant` `''` or `'nlh'`, `scope` starting with `'holdem:'`) when all five conditions hold:

1. At least `50` hands (`TIGHT_METHOD_LINE.minHands = 50`) in the read window (`120`-hand long participation window when `longHands > counterHands`, otherwise the decayed short counters).
2. Window VPIP at or below the observation method's line for the table size (`0.18` at `holdem:full` 9-max, `0.30` at `holdem:short` 6-max; `holdem:hu` has no line and never qualifies).
3. Window VPIP credibly below the cell's Horse VPIP mean at 90% posterior probability (`P(rate < vpipMean) >= 0.90`).
4. Window PFR at or below the cell's Horse PFR mean (excludes tight-aggressive raisers owned by earlier routes).
5. No contrary high-side evidence (`vpip.side !== 'high'` and `callShare.side !== 'high'`).

Confidence is `n / (n + 50)` multiplied by the low-side participation cap (`capLow`). It never overrides a loose read, never alters consumers directly (tight opener and tight re-raiser respect keep their own PFR tests), and never runs for heads-up, fixed-limit hold'em, pineapple, short deck, or Omaha.

Default OFF in source: read strictly as `opts.styleTightMethodLine === true` (`HorseLogic.ts` -> `HorseMind.ts` -> `HorseOpponentStyle.ts`). When absent or `false`, the branch is never entered, no receipt is emitted, and decisions and RNG state are byte-identical. Registered in `OPTION_SWITCH_PLAIN_NAMES` (`HorseOptionSwitch.ts`); not in `OPTION_SWITCH_OFF_ONLY`.

## The order it rests on

No owner or lane-lead order to activate `styleTightMethodLine` is recorded in the repository. It was built on 2026-11-16 (`docs/changelog/2026-11-16-tight-at-the-observation-line.md`) after four human-vs-Horse observation runs graded the tight-player classification check NOT MET for tight-calling humans (`VPIP 0.157-0.171`, `PFR ~0.09`, full ring).

## Receipts

- `style_tight_method_line_seen` (`HorseDataLedger.ts`, emitted in `HorseMind.ts` whenever `read.receipt.tightMethodLine` starts with `'tight:'`)
- `OpponentStyleRead.receipt.tightMethodLine` (`tight:<line>:...` or `none:...`, present only when the route runs)

## Tests

- `server/src/engine/aTightPlayerAtTheObservationLine.test.ts`: pins the two graded human rates (`VPIP 0.1567 / PFR 0.0823` and `VPIP 0.1669 / PFR 0.0914`, neutral off / tight on at saturated long window), average and loose non-triggers, thin-sample rejection (`0.18` on `60` hands, `49.9` vs `50` hands, `48` vs `52` long-window hands), high-PFR and contrary-evidence rejection, `0.30` short-handed line (`0.285 / 0.15`), and complete exclusion of heads-up, fixed-limit hold'em, pineapple, short deck, and PLO4.
- `server/src/engine/horseDecision/everyUpgradeHasALiveSwitch.law.test.ts`: pins `styleTightMethodLine` live-switch registration and default-OFF contract.

## Replay

Machine-read (README.md, "The Replay row"); the run row is written by the scorer and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2734; unjudged 0; set HVH48-D Hold'em cash vs people 48h (AsOf memory); scorer 5302af2ab3e; source placed verdict-only; arm tightMethod vs off; replayed 2734 of 3891

Unedited scorer line: `placed (verdict-only; 3891 audited decisions, 372 judged bad; joined by node: 2734 replayed, 1157 not replayed, base reproduces the recorded action on 2373): arm tightMethod changed 0 (0 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 0; judged bad left unchanged 240; no bb (the audit declares no EV model).`

Reach and memory coverage (2026-11-22, checkout `bc2f67f45ed6`, run single-threaded with `EQUITY_GOVERNOR=off nice -n 19` from `server/`, temporary replay output deleted immediately after scoring):

1. Audit set: HVH48 Auditor D (`D.nodes.jsonl`, `D.job.json`, placed from `decisions.csv` sha256 `0e36700096a0906d07a5e1ecd0829c35f1ad6abe423f16543103541899c521f0`): `3,891` audited NLH cash decisions (`372` bad, `1,542` ok, `1,977` unjudged), `2,734` replayable with Horse hole cards known.
2. Base arm (`off`): live production switch snapshot `prod-switch-20261122T0336Z.json` (`67` rows, `51` on, sha256 `a8eb5572c93fee606494b19d5bdd499e22bf61344f7954b29eb8b81ee7387200`, `0` rows sanitized, `0` refused by registry). Candidate arm (`tightMethod`): base plus `styleTightMethodLine: on`. Seeds `1,7,42`.
3. AsOf opponent memory (`--history`, REPLAY-V2): `76,098` retained `has_human` public `hand_history` rows prior to `2026-11-20 06:00Z` (concatenated sorted part files sha256 `099bfa4577efb31c13a2dcc5924040c7cc8bc1076192fa599aa4dd9f0d595a4d`), learned strictly before each decision's recorded action time into an isolated `AsOfOpponentMemory` sandbox (including sandbox style maps from `#11684`). Across the `2,734` replayed nodes (`1,483` `horse_only`, `1,000` `mixed`, `251` `people`), `2,682` nodes had at least one live opponent with `>= 50` hands in memory and `1,066` nodes faced a human opponent with `>= 50` hands (max `6,414` hands).
4. Outcome: `style_tight_method_line_seen` fired on `6` of `2,734` nodes (`differs from base on 6 of 2734 rows` in the scorer, `0` arm errors, replay sha256 `b9acb1c885551b658ac824ee756b095d410f6957c67282e532f019c4ca3ce62e`), and `0` decisions changed action or bet size (`changed 0`, `resized 0`, `fixed 0`, `newlyWrong 0`, `unchanged 2734`, `bad unchanged 240`).
5. Commands:
   - `npx tsx scripts/audited-node-option-replay.ts --job D.job.json --switch prod-switch-20261122T0336Z.json --history <hist-dir> --arms tightMethod=styleTightMethodLine --out <tmp-replay.jsonl> --seeds 1,7,42`
   - `npx tsx scripts/audited-decision-replay.ts --placed D.nodes.jsonl --replay <tmp-replay.jsonl> --line tightMethod --row tightMethod --set "HVH48-D Hold'em cash vs people 48h (AsOf memory)"`

Limits of this replay: durable `horse_exact_profiles` rows are not loaded (to avoid future leakage), and Horse-only hands are absent from the `has_human` history pull. The audit is verdict-only (no bb).

## League (2026-11-22, 3 seeds on live 67-row prod switch)

Run single-threaded (`EQUITY_GOVERNOR=off nice -n 19`) on checkout `bc2f67f45ed6` over the live 67-row production switch (`prod-switch-20261122T0336Z.json`, `0` sanitized rows; `styleValueBettorNotManiac` and `styleTightReRaiserRespect` both ON in base), with `memoryLearning` ON (league default) so opponent windows accumulate past `50` hands. Arm A adds `styleTightMethodLine: true`; arm B keeps base.

### 1. Declared mirror harm check: `nlh_style_tight_method_line` (6-max NLH cash, `productionStyles: true`, `6,000` pairs/seed)

| Seed       |      Pairs |      Hands |       bb/100 +/- SE |          z | Divergent pairs | Inert    | `style_tight_method_line_seen` | Illegal / Truncated |
| ---------- | ---------: | ---------: | ------------------: | ---------: | --------------: | -------- | -----------------------------: | ------------------: |
| `20261121` |      6,000 |     12,000 |     `0.00 +/- 0.00` |     `0.00` |               0 | true     |                              0 |               0 / 0 |
| `20261122` |      6,000 |     12,000 |     `0.00 +/- 0.00` |     `0.00` |               0 | true     |                              0 |               0 / 0 |
| `20261123` |      6,000 |     12,000 |     `0.00 +/- 0.00` |     `0.00` |               0 | true     |                              0 |               0 / 0 |
| **Pooled** | **18,000** | **36,000** | **`0.00 +/- 0.00`** | **`0.00`** |           **0** | **true** |                          **0** |           **0 / 0** |

### 2. 6-max NLH cash vs `HUMAN_CALIBRATED_POPULATION_ID` (`hybridBaseline: true`, `moodClock: 'deal_seed'`, `3,000` pairs/seed)

| Seed       |     Pairs |      Hands | Delta bb/100 +/- SE | Arm A / B abs bb/100 | Divergent pairs | Inert    | `style_tight_method_line_seen` | Illegal / Truncated |
| ---------- | --------: | ---------: | ------------------: | -------------------: | --------------: | -------- | -----------------------------: | ------------------: |
| `20261121` |     3,000 |      6,000 |     `0.00 +/- 0.00` |  `+139.69 / +139.69` |               0 | true     |                              0 |               0 / 0 |
| `20261122` |     3,000 |      6,000 |     `0.00 +/- 0.00` |  `+114.08 / +114.08` |               0 | true     |                              0 |               0 / 0 |
| `20261123` |     3,000 |      6,000 |     `0.00 +/- 0.00` |    `+77.89 / +77.89` |               0 | true     |                              0 |               0 / 0 |
| **Pooled** | **9,000** | **18,000** | **`0.00 +/- 0.00`** |                  n/a |           **0** | **true** |                          **0** |           **0 / 0** |

### 3. 9-max NLH cash vs `HUMAN_CALIBRATED_POPULATION_ID` (`hybridBaseline: true`, `moodClock: 'deal_seed'`, `3,000` pairs/seed)

| Seed       |     Pairs |      Hands | Delta bb/100 +/- SE | Arm A / B abs bb/100 | Divergent pairs | Inert    | `style_tight_method_line_seen` | Illegal / Truncated |
| ---------- | --------: | ---------: | ------------------: | -------------------: | --------------: | -------- | -----------------------------: | ------------------: |
| `20261121` |     3,000 |      6,000 |     `0.00 +/- 0.00` |  `+155.82 / +155.82` |               0 | true     |                              0 |               0 / 0 |
| `20261122` |     3,000 |      6,000 |     `0.00 +/- 0.00` |    `+52.69 / +52.69` |               0 | true     |                              0 |               0 / 0 |
| `20261123` |     3,000 |      6,000 |     `0.00 +/- 0.00` |  `+239.72 / +239.72` |               0 | true     |                              0 |               0 / 0 |
| **Pooled** | **9,000** | **18,000** | **`0.00 +/- 0.00`** |                  n/a |           **0** | **true** |                          **0** |           **0 / 0** |

Why all three league cards were inert: neither the production Horse population nor the loose-passive calibrated human population sits in the narrow tight-calling band (`VPIP <= 0.18` full-ring / `<= 0.30` 6-max, 90% credibly below the Horse mean, `PFR <= Horse PFR mean`, while neutral on earlier routes). An inert matchup (`divergentPairs = 0`) confirms zero harm on these fields, not positive value (`HorseLeague.ts` marks `inert: true` as no experiment).

## Evidence rows

- Mechanism, scope, visibility (`style_tight_method_line_seen`), unit tests, byte-identical off: MET.
- Input fidelity (production AsOf-memory replay): PARTIAL (`style_tight_method_line_seen` fired on `6` of `2,734` HVH48-D decisions with `1,066` nodes facing humans at `>= 50` hands, confirming live inputs reach the route, but `0` actions changed).
- Value against people and continuation: NOT MET (`0` divergent pairs across `72,000` league hands; `0` action changes across `2,734` AsOf-memory audited decisions).
- Harm check: `0` illegal actions, `0` truncated streets, `0` replay errors, `0` newly wrong decisions.

## Verdict (2026-11-22)

Evidence NOT MET. `styleTightMethodLine` stays OFF and no switch row is written.

What is still owed before this file may say `Evidence MET`:

1. A non-inert paired league evaluation against a tight-passive opponent field matching the target band (e.g., `VPIP 0.157-0.171`, `PFR ~0.09` at 9-max or `VPIP 0.26-0.29`, `PFR ~0.15` at 6-max, with `>= 50` hands learned in the 120-hand window) demonstrating statistically significant positive value (`|mean| > 2 SE`, positive) and non-zero divergence.
2. A larger audited Hold'em cash AsOf-memory replay set covering tight-passive human opponents where `style_tight_method_line_seen` produces non-zero decision changes, scored by `server/scripts/audited-decision-replay.ts --row` meeting its declared PASS-BAR (`newlyWrong <= fixed` and positive net fixes).
3. An explicit owner or lane-lead order to activate recorded verbatim in "The order it rests on".

## Rollback

No production switch row exists (`state` is OFF in source). If ever activated later, immediate rollback to source default OFF:

```sql
SELECT public.fn_ca_horse_option_switch_set(
  'styleTightMethodLine',
  'off',
  'rollback: styleTightMethodLine back to source default off'
);
```
