# readBreakEvenBluff: authority for the live switch

**State: OFF in source (read `=== true`), no switch row. Evidence NOT MET: after the 2026-11-08 neutrality and semi-bluff repair (`docs/changelog/2026-11-08-break-even-bluffing-leaves-unread-opponents-alone.md`), no league card or exploiter cell resolves significantly positive (41 of 54 cards inert, 13 inside 2 SE), the 2026-11-21 live 67-row switch verification is 100% inert (`0` divergent pairs on 6-max NLH human and 6-max NLH mirror, `0/0/0/0/0`), and the 2026-11-21 `AsOfOpponentMemory` audited replays across 22,031 real human-vs-Horse decisions (`HVH48-D`, `HVH48-E`, `HVH48-B`, `HVH48-C`) fire `break_even_bluff_priced` on 63 PLO5/PLO6 nodes while changing `0` actions (`fixed 0`, `newlyWrong 0`, `changed 0`). Do not switch on.** Mechanism, scope, neutrality, receipts, tests, and off-identity are met; positive value and replay reach (`>= 20 changed`, `>= 8 fixed`) are not met.

## What it does

Postflop bluff pricing across NLH and PLO4/5/6 (cash and tournament), wired through `HorseMind.tableExploit` (`breakEvenBluffOf` in `server/src/engine/HorseMind.ts`) and `HorseLogic.ts` (`bluffScaleAt`):

- **Engagement gate (neutrality).** `breakEvenBluffOf` returns nothing (leaving the existing `bluffMod` unchanged) unless the opponent's postflop bluff read is already credibly engaged (`postflopBluffMod(opponentRead) !== null`, i.e., real decayed fold-to-bet or river-call evidence outside the normal Horse population envelope). Unread strangers, normal regulars, and decisions with `mind: false` are byte-identical to flag OFF.
- **Sizing-aware break-even multiplier.** When engaged, replaces `bluffMod` with the break-even multiplier at `BREAK_EVEN_REFERENCE_SIZE` and rescales any bet of size `s` and called equity `e` via `breakEvenFoldShare(s, e) = s * (1 - 2e) / (1 + s - e * (1 + 2s))`, the fold share at which betting equals checking (`s / (1 + s)` for pure air; `0` for `e >= 0.5`).
- **Multiway weakest-link cap.** In multiway pots (`tableExploit`), unread responders still constrain the weakest-link limit at their existing price; the break-even price attaches only when it is lower than every unread responder's price.

Off (absent, `false`, or non-boolean): `opts.readBreakEvenBluff === true` is false, `breakEvenBluff` and `foldShift` stay `undefined`, and every decision is byte-identical.

## Receipts and Tests

- **Receipt:** `break_even_bluff_priced` (registered in `server/src/engine/HorseDataLedger.ts`, zero in production while default OFF).
- **Tests:** `server/src/engine/HorseMindBreakEvenBluff.test.ts` (19 tests covering the neutrality gate, bet-equals-check identity, short-sample non-engagement, reads-off symmetry, and multiway weakest-link limit) and `server/src/engine/HorseMindReadCalibration.test.ts`. With the flag forced on locally on 2026-11-08 after the repair, all 6 previously failing standing suites (`HorseOpponentExploitNeutrality.law.test.ts`, `HorseV54RiverBluff.test.ts`, `HorseSkillActivationWiring.law.test.ts`, and `HorseOpponentExploitBehavior.test.ts`) passed.

## Evaluation

### 1. Historical pre-repair vs post-repair multi-seed evidence (2026-11-08)

- **Superseded pre-repair run** (`docs/changelog/2026-11-08-the-heads-up-tournament-bluff-loss-was-noise.md`): showed 7 significant wins (`+0.58` to `+2.72 bb/100`) only because an unread-opponent bug applied a `1.45x` bluff boost against strangers and failed 6 standing neutrality/behavior tests. Those numbers do **not** apply to the current code on `main`.
- **Post-repair run** (`docs/changelog/2026-11-08-break-even-bluffing-leaves-unread-opponents-alone.md`, 3 seeds `20261110, 20261120, 20261121` across all 54 league cards and 20 exploiter cells, arm A `{ readBreakEvenBluff: true }` vs arm B `{}`):
  - All 10 Horse mirror cards (`216,000` pairs): `0` divergent pairs (inert).
  - All 4 Calibrated human-field cards (`144,000` pairs): `0` divergent pairs (inert).
  - 6 standard river-bluff cells + 15 of 16 PLO5/PLO6 cells: inert (`PLO5 tournament mixed` `+0.18 +/- 0.13`, 2 pairs).
  - 18 NLH/PLO4 station, over-folder, and mixed cells: 6 inert, 12 inside 2 SE; closest was `nlh cash stations 2-max` at `+0.52 +/- 0.38 bb/100` (`351` divergent pairs), `nlh tournament stations 2-max` `+0.25 +/- 0.41` (`871` div), `nlh tournament stations 6-max` `+0.24 +/- 0.18` (`110` div).
  - 20 exploiter cells (`3,000` pairs x 3 seeds, memory on): pooled edges `-0.3` to `+0.9 bb/100` against SE `3.8` to `59.3` (all inside SE).
  - `hu_break_even_bluff` is retired in `HorseLeague.ts` as unanswerable on standard mirrors (`0/6,000` divergent pairs across 3 nights).

### 2. Live 67-row production switch check (2026-11-21)

Measured 2026-11-21 on `origin/main` (`bc2f67f45ed6`), `EQUITY_GOVERNOR=off`, `moodClock: 'deal_seed'`, arm A = live 67-row production switch snapshot (`prod-switch-20261122T0336Z.json`, `0` sanitized) plus `readBreakEvenBluff: true`, arm B = live 67-row snapshot (`readBreakEvenBluff: false`), 3 seeds (`20261121`, `20261122`, `20261123`) x 3,000 pairs (18,000 hands per field, 36,000 hands total):

- **6-max NLH cash 100bb vs `HUMAN_CALIBRATED_POPULATION_ID`** (`hybridBaseline: true`):
  - `20261121`: `+0.00 +/- 0.00 bb/100` (`div = 0`, `0/0/0/0/0`)
  - `20261122`: `+0.00 +/- 0.00 bb/100` (`div = 0`, `0/0/0/0/0`)
  - `20261123`: `+0.00 +/- 0.00 bb/100` (`div = 0`, `0/0/0/0/0`)
  - **Pooled**: **`+0.00 +/- 0.00 bb/100`** (`div = 0`, `0` illegal, `0` truncated, `0` corrected, `0` exceptions, `0` mismatches; 100% inert as designed).
- **6-max NLH cash 100bb Mirror** (`productionStyles: true`):
  - `20261121`: `+0.00 +/- 0.00 bb/100` (`div = 0`, `0/0/0/0/0`)
  - `20261122`: `+0.00 +/- 0.00 bb/100` (`div = 0`, `0/0/0/0/0`)
  - `20261123`: `+0.00 +/- 0.00 bb/100` (`div = 0`, `0/0/0/0/0`)
  - **Pooled**: **`+0.00 +/- 0.00 bb/100`** (`div = 0`, `0` illegal, `0` truncated, `0` corrected, `0` exceptions, `0` mismatches; 100% inert as designed).

## Replay

Machine-read (README.md, "The Replay row"); run rows below are written by the committed scorer and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 3763; unjudged 0; set HVH48-B PLO5 cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 3763 of 3884
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 10178; unjudged 0; set HVH48-C PLO6 cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 10178 of 11558

Run 2026-11-21 on `origin/main` (`bc2f67f45ed6`), scorer `5302af2ab3e`, with **`AsOfOpponentMemory` ON** (`--history` loaded `76,098` retained public `has_human` hands from `replayv2-work/hist`, learned strictly before each decision's timestamp), base arm `off` = live `67`-row production switch snapshot (`prod-switch-20261122T0336Z.json`, `0` sanitized, `0` refused), arm `on` = base plus `readBreakEvenBluff`, seeds `1,7,42`, `0` arm errors (scratch files with hole cards deleted immediately after scoring):

- **`HVH48-D` Hold'em cash vs people 48h** (`3,891` audited, `2,734` replayed in `394` hands, `2,682` with an opponent record of `>= 50` hands in `AsOfOpponentMemory`): arm `on` differed from base `off` on **`0` of `2,734` rows** (100% inert; zero `break_even_bluff_priced` receipts; refused by scorer without `--allow-unchanged`, so no run row is recorded for D).
- **`HVH48-E` Hold'em tournaments vs people 48h** (`10,937` audited, `5,356` replayed in `1,478` hands): arm `on` differed from base `off` on **`0` of `5,356` rows** (100% inert; refused by scorer without `--allow-unchanged`, so no run row is recorded for E).
- **`HVH48-B` PLO5 cash vs people 48h** (`3,884` audited, `3,763` replayed in `1,248` hands): arm `on` differed from base `off` on **`36` of `3,763` rows** via the `break_even_bluff_priced` receipt (confirming `AsOfOpponentMemory` engaged real PLO5 opponent reads), with `0` action changes, `0` resizes, `0` fixed, `0` newly wrong (`base reproduces recorded 3005`, `79.9%`).
  - Unedited scorer line (`HVH48-B`): `placed (verdict-only; 3884 audited decisions, 284 judged bad; joined by node: 3763 replayed, 121 not replayed, base reproduces the recorded action on 3005): arm on changed 0 (0 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 0; judged bad left unchanged 223; no bb (the audit declares no EV model).`
- **`HVH48-C` PLO6 cash vs people 48h** (`11,558` audited, `10,178` replayed in `1,217` hands): arm `on` differed from base `off` on **`27` of `10,178` rows** via the `break_even_bluff_priced` receipt, with `0` action changes, `0` resizes, `0` fixed, `0` newly wrong (`base reproduces recorded 7866`, `77.3%`).
  - Unedited scorer line (`HVH48-C`): `placed (verdict-only; 11558 audited decisions, 924 judged bad; joined by node: 10178 replayed, 1380 not replayed, base reproduces the recorded action on 7866): arm on changed 0 (0 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 0; judged bad left unchanged 530; no bb (the audit declares no EV model).`
- **`HVH48-A` PLO4 cash vs people 48h**: not replayed here (`HVH48-A` uses a separate CSV layout without `decisions.csv`); owed if promotion is ever revisited.
- **Against REPLAY-6 bar** (`>= 20 changed`, `fixed >= 2 x newlyWrong` and `>= 8`): **NOT MET (`changed 0`, `fixed 0` across all 22,031 replayed decisions)**.

## Rollback / Switch Control

Source default is OFF (`opts.readBreakEvenBluff === true`), and no live switch row exists. If ever enabled, rollback takes ~30 seconds via the live switch RPC:

```sql
select public.fn_ca_horse_option_switch_set('readBreakEvenBluff', 'off', 'rollback: readBreakEvenBluff');
```

Clearing the row also returns the engine to the source default (OFF).

## What remains owed for promotion

1. A statistically significant positive paired EV measurement on the engaged station / over-folder cells (the only populations where `postflopBluffMod` engages after the 2026-11-08 neutrality fix; best prior post-repair cell was `nlh cash stations 2-max` at `+0.52 +/- 0.38 bb/100`).
2. Non-inert audited replay reach (`>= 20 changed`, `fixed >= 2 x newlyWrong`, `>= 8 fixed`), including `HVH48-A` PLO4 cash, on an audit slice containing humans with credibly engaged postflop fold-to-bet or river-call reads.
