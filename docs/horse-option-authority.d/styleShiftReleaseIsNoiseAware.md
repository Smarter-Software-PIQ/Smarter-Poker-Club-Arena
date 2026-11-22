# styleShiftReleaseIsNoiseAware: authority for the live switch

Status: merged (`PR #11643`, `01919ce6e496`), default OFF, Evidence NOT MET: the option is registered default OFF (read `=== true`, release default off, no switch row; migrations `20261121171027` and `20261122011559` installed in production with `fn_ca_horse_option_switch_states` = `["off","on"]`) and stays off. It is the root fix of a defect in the 2026-11-06 style-shift release, built 2026-11-21 by the Antigravity coordinator lane (session `01Gw7aDtgw51ks82iZdeEMVr`). Post-merge 3-seed live-67-row production-switch evaluation (`168,000` hands across NLH, PLO4, and FLH, `0/0/0/0` safety) clears harm across all three variants (`+3.33 +/- 4.05` NLH, `+2.03 +/- 6.15` PLO4, `+0.37 +/- 0.12 z=+3.10` FLH), while audited single-hand journal replay is structurally inert for a learning-side option; promotion still needs a formally declared production-switch card (or multi-hand stateful opponent-memory replay) and owner/SWITCH approval; see Verdict.

## The defect it fixes

`HorseOpponentExploit.styleShiftReleased` (Dan's ruling of 2026-11-06, `docs/changelog/2026-11-06-opportunity-scoped-decay-with-style-shift-release.md`: "Ship it; allow 14 in PLO4"; the 0.2 gap and the 3-sample floor were accepted there as costing releases on "about 5-7% of all updates for stable players") fires when any of six fast-window rates (pfr, rfi, three-bet, bet when checked to, fold to a bet, river call) is 0.2 from its long-window rate on at least 3 decayed fast opportunities, and then ages EVERY long-window opportunity-gated statistic at the 8-hand rate. Measured by the Fixed-Limit coordinator agent (PR #11637, `docs/horse-league-fixed-limit.md`, "The over-folder read and mixed frequencies"): the comparison has no allowance for sampling noise, so a player whose frequencies never change trips it on 2-4% of hands, and one firing ages every statistic, so a stable 26% first-in raiser who faces a postflop bet on 3% of hands keeps a third of the decayed fold-to-bet sample he keeps with no release. It runs in every Horse's live memory (`HorseMind.observeExploitHand`, `mergeSandboxExploit`), in the durable profile's SQL twin (`fn_horse_exploit_add`, migration 20261107022913) and in the intra-session gear-shift gate of `opponentExploitRead`.

## What it does

With the option on (`HorseOpponentExploit.STYLE_SHIFT_NOISE_K`, `styleShiftMoved`, `decayAndAddNoiseAwareRelease`):

1. A statistic MOVED only when its fast rate differs from its long rate by at least `max(0.2, 1.5 * sqrt(q (1 - q) / nFast))`, on at least 3 decayed fast opportunities; `nFast` is the decayed fast count and `q` the long rate shrunk half an observation toward one half (`(s + 0.5) / (n + 1)`), so a long rate of 0 or 1 does not collapse the bound. The ruled 0.2 gap stays the floor; nothing releases on less.
2. A moved gated statistic (rfi, three-bet, bet when checked to, fold to a bet, river call) ages only its own long window at the fast rate.
3. A moved preflop raise rate (the one statistic sampled on every hand) still ages every gated statistic: a player who changes his preflop raising changes which spots he reaches, and the frozen evidence of the spots he no longer reaches is what the release exists to retire (the maniac who calms down).
4. `styleShiftReleased` (and so the gear-shift gate of `opponentExploitRead`) answers "some statistic moved".

Why `k = 1.5`: `nFast` understates the exponentially weighted window's effective sample (at saturation `(1 + d) / (1 - d) = 23.1` against `12.0` decayed hands), so 1.5 on `nFast` is about 2.1 standard errors of the window. On the stationary simulation of `docs/horse-league-fixed-limit.md` (six seeds, 3,000 measured hands each) a stable player releases on 0.45-0.58% of hands at 1.5 (2.2-4.3% today) and 0.01-0.03% at 2.0; at 2.0 a first-in raiser who moves from 26% to 45% is not released within 200 hands (1.5: median 51).

Off (absent, false or anything but `true`): the 2026-11-06 rule byte for byte, in TypeScript and in SQL.

PROCESS-LEVEL, like `fixedLimitBetsAreNeverProbes`: opponent learning runs outside a decision, so the decision worker applies the registry state before every job (`workerRuntime.applyProcessSwitches` and the decision's own read, `HorseMind.applyStyleShiftReleaseIsNoiseAwareOption`); no row, an unreadable, invalid or stale read put back off. It takes no `shadow` (`OPTION_SWITCH_SHADOW_REFUSED`): the memory it changes is learned outside the decision a shadow re-decides.

## The durable profile (SQL twin)

Migration `20261121171027_the_style_shift_release_can_be_noise_aware.sql`: `fn_horse_exploit_add_rule(base, delta, hands, noise_aware)` (IMMUTABLE; `false` is the 20261107022913 body byte for byte), `fn_horse_style_shift_release_is_noise_aware()` (STABLE: true only while `ca_horse_style_switch` holds an `on` row for this option, the row the engine reads), and `fn_horse_exploit_add` (same signature, default and STRICT contract, now STABLE) calling the rule with the switch. The engine and the database read the same row, so live memory and the persisted profile learn by the same rule; between a switch write and the worker's next poll (one poll window) a hand may be learned by the database under the new state and in process under the old one, which a reload settles to the database's counters. A multi-hand import (`p_hands <> 1`) keeps the per-hand rule in both states. Either side may be installed first: an engine without the option never writes the row, and the function reads no row as off.

Proved on PostgreSQL 16 by `scripts/ci/test-horse-exploit-style-shift-release-postgres.py --scratch <dir>` (cases from `scripts/ci/horse-exploit-style-shift-release-cases.ts`, 4,000 random rows, seed 20261121), measured 2026-11-21:

```
ok  cases: 4000
ok  switch absent: identical to 20261107022913 (text): 0
ok  switch absent agrees with the engine off: 0
ok  switch off: identical to 20261107022913: 0
ok  switch shadow: identical to 20261107022913: 0
ok  switch on_shadow: identical to 20261107022913: 0
ok  switch on agrees with the engine on: 0
ok  switch on differs from the 2026-11-06 rule on some rows: true
ok  switch on: multi-hand import keeps the per-hand rule: 0
ok  rule off agrees with the engine off: 0
ok  rule on agrees with the engine on: 0
PASS 4000 rows (2026-11-06 rule released on 2680, the noise-aware rule moved a statistic on 3517)
```

## Receipts

`style_shift_noise_aware_released` (a statistic moved on this update) and `style_shift_noise_aware_withheld` (the 2026-11-06 rule would have released every gated statistic and the noise-aware rule released none), `HorseDataLedger.ts`; the switch's own `option_switch_styleShiftReleaseIsNoiseAware_on_seen`.

## Tests

- `server/src/engine/HorseStyleShiftReleaseNoiseAware.test.ts`: off is the 2026-11-06 rule byte for byte on 20,000 random updates (against a verbatim copy of the shipped rule); the bound; a moved rfi ages only rfi; a moved pfr still ages everything; a stable 26% and 50% first-in raiser keep their fold sample with the option on (on more than 30 decayed opportunities, off fewer than 16 and 10); the process switch follows the worker's options; the `HorseManiacPressure` style-change streams read the same hands with the option on (NLH calm 21, nit to maniac 11; PLO4 17 and 12; off 21 / 11 and 17 / 13; the law's pins are 25, 12 and 14).
- `tests/unit/horseExploitDurableDecayMatchesEngine.test.ts`: the SQL twin carries the same bound and reads the same switch.
- `server/src/engine/horseDecision/AFixedLimitProbeSwitchIsLive.law.test.ts`: the worker applies both process switches before every job.
- `HorseLeague.withLeagueProcessSwitches` / `refuseMirrorProcessSwitchSplit`: a human-field card runs each pass with its own arm's switch; a mirror card cannot split it and refuses.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the option changes how opponent memory is learned across hands, not a decision taken from a recorded read frame; journal replay re-decides with opponent memory off (`replayAt` passes `mind: false`) and the read frame as recorded, so on and off replay identically by construction; a replay needs the audited hands re-learned from their history under each rule, which no committed harness does as of 2026-11-21)

Journal replay structural limit: audited single-hand journal replay runs with opponent memory off (`mind: false`), so `styleShiftReleaseIsNoiseAware` is structurally inert there and requires multi-hand stateful opponent-memory replay or live shadow/on-shadow observation instead.

## League

Sizes and seeds were fixed before the runs: seeds `20261120` and `20261121`; bb/100 is arm A (option on) minus arm B, seeds combined as the mean with `sqrt(se1^2 + se2^2) / 2`. Engine `fece70814` (first seed; the NLH card of that seed printed `+uncommitted changes under server/src`, which were test files only) and `9e147297c` (second seed), run from `server/`.

| Card                                                                                                                                                      | Field                                             | Pairs per seed | Seed 20261120                         | Seed 20261121                          | Seeds together                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------- | ------------------------------------- | -------------------------------------- | -------------------------------------- |
| `flh_style_release_noise_aware_steal_vs_value_only_blinds` (`horseLeagueCard.ts`; both arms `fixedLimitStealVsTightBlinds`, A adds the option)            | scripted `flh_value_only_blinds_v1`, 6 seats      | 20,000         | +0.51 +/- 0.15, z 3.44, 84 diverged   | +0.13 +/- 0.16, z 0.83, 68 diverged    | +0.32 +/- 0.11, z 2.96, SIGNIFICANT    |
| `human_nlh_style_release_noise_aware` (`horseLeagueCard.ts`)                                                                                              | calibrated NLH people, 6 seats                    | 12,000         | +10.05 +/- 5.56, z 1.81, 422 diverged | +15.60 +/- 5.61, z 2.78, 414 diverged  | +12.83 +/- 3.95, z 3.25, SIGNIFICANT   |
| `plo4_style_release_noise_aware_vs_omaha_dev_field` (`styleShiftReleaseLeague.ts --part=omaha`; the Omaha development field is kept off the nightly card) | calibrated Omaha development field, PLO4, 6 seats | 6,000          | -0.05 +/- 8.98, z -0.01, 47 diverged  | -27.79 +/- 12.04, z -2.31, 86 diverged | -13.92 +/- 7.51, z -1.85, not resolved |

The steal alone against the same value-only blinds diverged on 2 of 20,000 pairs at each seed (`docs/horse-league-fixed-limit.md`); with the noise-aware release the over-folder reads fill and it diverges on 84 and 68. Every card: 0 illegal actions.

Harm control, opponents that really change gear (`styleShiftReleaseLeague.ts --part=gear`, ExploiterLeague cell, production Horses at the other five seats, the whole cell run with the switch off and then on, same seed and deals, 3,000 pairs). The number is the gear-changer's own bb/100 against the Horses (lower is better for the Horses); the difference's error treats the two runs as independent, which overstates it.

| Opponent                                                                          | Seed 20261120 off / on                | Seed 20261121 off / on                | On minus off, seeds together            |
| --------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------------------- |
| `lp_time_shifter` (selective and maniac gears alternating every 200 of its hands) | -143.43 +/- 48.18 / -176.09 +/- 50.33 | -105.67 +/- 45.35 / -123.40 +/- 47.21 | -25.20 +/- 47.80, z -0.53, no harm seen |
| `lp_tight_image` (tight for 150 hands, then barrels and raises rivers with air)   | -22.79 +/- 21.15 / -25.42 +/- 20.85   | 0.64 +/- 21.16 / -9.41 +/- 22.65      | -6.34 +/- 21.46, z -0.30, no harm seen  |

Receipts with the option on (time shifter / tight image): released 2,120 / 1,807 and withheld 9,289 / 8,900 updates at seed 20261120; 2,124 / 1,795 and 9,684 / 9,044 at seed 20261121.

### PLO4 root-cause diagnosis and live-production-switch 3-seed check (2026-11-21)

**PLO4 bare-switch anomaly diagnosis (`seed 20261121`, `6,000` pairs, `LeagueChangedNodeTable`):** On the bare `b = {}` card (`-27.79 +/- 12.04 bb/100`, `86` diverged pairs), the #1 negative driver was 4 `preflop/facing_3` 150-bb stack-offs (`fold vs call`, `n = 4`, `meanBb = -152.13`, `share = -10.14 bb/100`) plus `preflop/facing_1 raise vs call` (`n = 6`, `-3.41`) and `preflop/facing_3 call vs fold` (`n = 2`, `-3.27`), triggered because keeping `threeBet` decayed samples alive (`~30-40` vs `~12-14`) flips `human-cal-v1-omaha`'s 30.1% 3-bet rate across `plo4:short edgeHi = 0.2039` into evidenced preflop maniac without production's Omaha preflop/style switches. Enabling `omahaPressureNeedsPostflopAggression` reduced the swing to `-21.27 +/- 10.57` (`div = 85`), and enabling `omahaNeutralUnknown` collapsed it to `-4.60 +/- 10.25` (`z = -0.45`, `div = 96`, `preflop/facing_3 fold vs call` flipping to `+7.81`).

**PLO4 3-seed check on the exact live 66-row production switch set (`ca_horse_style_switch` snapshot `2026-11-21T20:00Z`, `6,000` pairs/seed = `18,000` pairs / `36,000` hands, `EQUITY_GOVERNOR=off`):**

| Seed     | Delta (bb/100)     | z       | Diverged | Illegal | Truncated |
| -------- | ------------------ | ------- | -------- | ------- | --------- |
| 20261120 | `+19.77 +/- 13.25` | `+1.49` | 51       | 0       | 0         |
| 20261121 | `+1.23 +/- 9.45`   | `+0.13` | 80       | 0       | 0         |
| 20261122 | `-5.92 +/- 9.24`   | `-0.64` | 48       | 0       | 0         |
| Combined | `+5.03 +/- 6.23`   | `+0.81` | 179      | 0       | 0         |

Combined across all 3 seeds: `+5.03 +/- 6.23 bb/100` (`z = +0.81`), zero harm and zero significant negative seed (`min z = -0.64`).

### Post-merge 3-seed live 67-row production-switch evaluation (2026-11-22)

Measured on `9ece781796fd` (Turn 3 `PR #11643`, merged on `origin/main` as `01919ce6e496` with migrations `20261121171027` and `20261122011559` installed and `fn_ca_horse_option_switch_states` = `["off","on"]`) against the exact live `67`-row `public.ca_horse_style_switch` snapshot (`2026-11-22T03:36Z`, `51 on / 16 off`: `7` style `on`, `44` plain `on` including `styleTightPlayerExploit` and `omahaBlanketRowsOffInPlo45Cash`, `16` plain `off`; seeds `20261121, 20261122, 20261123`, `hybridBaseline: true`, `moodClock: 'deal_seed'`, `EQUITY_GOVERNOR=off`, `168,000` hands total; `0` illegal, `0` truncated, `0` corrected, `0` brain exception fallbacks across all 9 runs):

| Card (live 67-row prod switch)                                                         | Pairs/seed | Seed 20261121                              | Seed 20261122                             | Seed 20261123                              | Pooled (3 seeds)                            | Diverged | Safety  |
| -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------ | ----------------------------------------- | ------------------------------------------ | ------------------------------------------- | -------- | ------- |
| NLH 6-max calibrated human (`HUMAN_CALIBRATED_POPULATION_ID`)                          | 12,000     | `+15.77 +/- 5.63` (`z = +2.80`, `417` div) | `+0.90 +/- 6.79` (`z = +0.13`, `413` div) | `-6.69 +/- 8.35` (`z = -0.80`, `430` div)  | `+3.33 +/- 4.05` (`z = +0.82`)              | 1,260    | 0/0/0/0 |
| PLO4 6-max Omaha dev (`HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`)                      | 6,000      | `+1.23 +/- 9.45` (`z = +0.13`, `80` div)   | `-5.92 +/- 9.24` (`z = -0.64`, `48` div)  | `+10.78 +/- 12.87` (`z = +0.84`, `66` div) | `+2.03 +/- 6.15` (`z = +0.33`)              | 194      | 0/0/0/0 |
| FLH 6-max steal (`flh_value_only_blinds_v1`, `fixedLimitStealVsTightBlinds` both arms) | 10,000     | `+0.17 +/- 0.18` (`z = +0.93`, `29` div)   | `+0.32 +/- 0.14` (`z = +2.31`, `35` div)  | `+0.62 +/- 0.27` (`z = +2.25`, `53` div)   | `+0.37 +/- 0.12` (`z = +3.10`, SIGNIFICANT) | 117      | 0/0/0/0 |

Every pooled mean on the live 67-row production switch set is positive (`+3.33` NLH, `+2.03` PLO4, `+0.37` FLH) with worst single-seed `z = -0.80` and `0/0/0/0` safety across `168,000` hands.

## Evidence rows

- Mechanism, scope, receipts, tests, byte-identical off (TypeScript and SQL): MET (`PR #11643` merged `01919ce6e496`; migrations `20261121171027` and `20261122011559` installed).
- Value against people: NOT MET. On the live 67-row production switch set (`2026-11-22T03:36Z`, 3 seeds), FLH scripted steal is significant (`+0.37 +/- 0.12`, `z = +3.10`, `0` live FLH human hands), while NLH 6-max calibrated human (`+3.33 +/- 4.05`, `z = +0.82`, `72,000` hands) and PLO4 6-max Omaha dev (`+2.03 +/- 6.15`, `z = +0.33`, `36,000` hands) are positive but below the three-significant-run default-on promotion bar.
- Harm: CLEARED ON LIVE PRODUCTION SWITCHES. The bare `b = {}` Omaha development field read `-13.92 +/- 7.51` (`z -1.85`, seed 20261121 `-27.79 +/- 12.04`, `z -2.31`), traced via `LeagueChangedNodeTable` to missing production Omaha preflop/style switches (`omahaPressureNeedsPostflopAggression`, `omahaNeutralUnknown`). On the live 66-row (`2026-11-21T20:00Z`) and live 67-row (`2026-11-22T03:36Z`) production switch sets, PLO4 reads `+5.03 +/- 6.23` (`z = +0.81`) and `+2.03 +/- 6.15` (`z = +0.33`, `min z = -0.64`), NLH reads `+3.33 +/- 4.05` (`z = +0.82`, `min z = -0.80`), FLH reads `+0.37 +/- 0.12` (`z = +3.10`), all with `0/0/0/0` safety, and the gear-changer controls show no harm.
- Real-hand replay: not run (structurally inert under single-hand `mind: false` journal replay; see above).

## Verdict (2026-11-22)

Status: merged (`PR #11643`, `01919ce6e496`, migrations `20261121171027` and `20261122011559` installed, `fn_ca_horse_option_switch_states` = `["off","on"]`), default OFF, Evidence NOT MET; the option stays OFF and no switch row is written. Missing for promotion: (1) significant positive production-switch runs on live-trafficked human variants (NLH/PLO4) under a formally declared card; (2) multi-hand stateful opponent-memory replay (process switches refuse `shadow`); and (3) owner/SWITCH approval.

## Rollback

If enabled, set `styleShiftReleaseIsNoiseAware` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('styleShiftReleaseIsNoiseAware', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
