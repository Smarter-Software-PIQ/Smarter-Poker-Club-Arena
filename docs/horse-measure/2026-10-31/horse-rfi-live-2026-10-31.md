# Horse Hold'em (NLH) live raise-first-in vs GTO, 2026-10-31

Read-only measurement. Nothing was written to production: every statement was a single SELECT (CTEs only, `SET LOCAL enable_nestloop = off`), no pg_temp objects were needed.

- **Window:** `[2026-10-30 20:40, 2026-10-31 20:40)` UTC, `hand_history.created_at`, `game_variant = 'nlh'`, bomb pots excluded.
- **Serving engine at measurement:** `eed06fe5` (`releaseSha eed06fe51dea622069c661a6213d5b031ff3a9e3`, `curl -s https://engine.smarter.poker/health` at 21:05 UTC, uptime 3,413 s, so it started about 20:09 UTC). Only the last of the 24 sample blocks (20:10-20:30) was dealt by this build. The other 23 were dealt by whatever builds served before it, and the window does not separate them.
- **Sample:** minutes :10-:30 of every hour (24 blocks, a third of the window). Inside each block I took every hand with 4+ dealt players and a 25% hash sample of 2-3 handed hands. That gives **49,130 nlh hands** and **153,706 horse unopened decisions** (cash 79,843, MTT 73,863). Humans: every `has_human` nlh hand in the window, 1,022 hands and 545 human unopened decisions. The grids for cash 6-handed >150bb and MTT 8-9 handed >80bb come from one grid-only statement (`x0`) over the first chunk's 8 blocks, a ninth of the window, so their cells are thinner.
- **Script:** `scripts/horse-measure/horse-rfi-live.py` (`plan` / `render` for the MCP route, `run` for psql). The raw MCP results are in `docs/horse-measure/2026-10-31/results/rfi-2026-10-31/` (`c0-c2.json` horse chunks, `hum.json`, `x0.json` extra grids, `body.md` = rendered sections 1-4 below). Each result carries checksums (`agg_check`, grid `tot_n`/`tot_r`) and `render` refuses a file that fails them. All five files pass.

## How it is measured

- **Source.** `public.hand_history.actions` records every dealt hand with a `publicNode` on every voluntary decision (stacks, `toCall`, `currentBet`, seats). Hole cards are recorded only at showdown, and `horse_hand_reviews` keeps only hands with |net| >= 20bb. Neither can give an unbiased open-frequency denominator. So the 13x13 grids take `hand_class` from `public.ca_hand_facts`, which has a row for every dealt seat, hash-joined on (hand_id, user_id). 0 grid decisions were left without a class.
- **Unopened decision.** The first voluntary preflop action by a seat while every earlier voluntary action was a fold. Raise or all-in for more than 1bb counts as an open (RFI), a call counts as a limp, and folds include timeout folds. The BB never has one, because a walk ends the hand. I dropped hands with a straddle, a dead-blind post, a missing small blind or more than one bb poster. With the few that had no readable stacks, 221 of 49,130 hands gave no usable decision.
- **Position.** Taken from the dealt seats in `players[]` and the bb poster, counted from the button: BTN, CO, HJ, LJ. At 6+ handed the first seat to act is UTG, then UTG+1 at 8+ handed and UTG+2 at 9-handed. Cross-check against `ca_hand_facts.position` on the grid rows: cash 6-handed agrees 100% (8,113/8,113). MTT differences are naming (facts calls the 7-handed second seat UTG+1 where I say LJ, and the 9-handed third seat MP) plus about 2% of hands shifted one seat (dead button or a sitting-out seat).
- **Effective stack.** min(hero start stack, the largest start stack among players not yet folded), read from the hero's own decision node, in bb. Buckets: cash <60 / 60-150 / >150; MTT <=15 / 15-25 / 25-40 / 40-80 / >80.
- **Open size.** The raise-to amount in bb (the engine records raises as the street total). Open shoves are counted separately and kept out of the average.
- **Card removal (read before the flags).** The bands describe range width, the share of the 1,326 combos opened. A seat that is folded to is dealt better than random cards, because the folders held weak ones. So the raw RFI of late positions overstates range width. Where a grid exists I also give the **combo-weighted** RFI: each class's open rate weighted by its 4/6/12 combos. For example, MTT 6-9 handed 25-40bb BTN is 58.5% raw but 53.7% combo-weighted.

### Comparison bands (given)

| context | UTG | HJ | CO | BTN | SB |
|---|---:|---:|---:|---:|---:|
| 6-max cash 100bb | 15-18% | 19-23% | 26-30% | 40-48% | 40-50% |
| MTT with BB ante | 17-20% | ~22% (graded 20-24) | 28-32% | 45-55% | - |
| MTT short stacks | push/fold (not graded under 25bb) | | | | |

## Summary

### Cash, 6-handed (46,014 horse decisions; 77% of them more than 150bb deep, average effective stack 185-252bb)

| position | RFI % | limp % | avg open | band | verdict | range width (combo-weighted grid) |
|---|---:|---:|---:|---|---|---|
| UTG | 15.3% | 0.0% | 2.11bb | 15-18 | in band; **LOW at 60-150bb (14.1%) and under 60bb (12.5%)** | 14.1% (60-150) |
| HJ | 20.4% | 0.0% | 2.13bb | 19-23 | in band; LOW under 60bb (18.8%) | 19.4% (60-150) |
| CO | 29.0% | 0.0% | 2.07bb | 26-30 | in band; LOW under 60bb (20.6%) | 26.8% (60-150), 29.2% (>150) |
| BTN | 48.4% | 0.0% | 2.08bb | 40-48 | **HIGH by 0.4 points raw (49.6% at >150bb)**; in band after the card-removal correction | 44.3% (60-150), 47.2% (>150) |
| SB | 31.2% | 2.9% | 2.16bb | 40-50 | **LOW at every depth** (raise + limp only 34.2%) | 27.7% (60-150), 30.1% (>150) |

- **The in-band totals hide a non-GTO range shape.** At UTG and HJ the horses open **no suited connectors or one-gappers**: T9s, 98s, 87s, 76s and 65s are 0/9, 0/12, 0/11, 0/7 and 0/3 at UTG 60-150bb. They also fold **K9s, Q9s and J9s** at 0%, **small pairs** (UTG 22-55 at 0-17%, 66 at 47%) and most of A9s-A2s (12-67%). The width comes back from **offsuit broadways**: KJo 94%, QJo 65%, ATo 87% and KTo 29% at UTG; KTo and ATo at 100% at HJ. UTG lands at 14.1% only because those offsuit hands replace the suited ones.
- **SB is the main cash leak (LOW).** It folds most offsuit aces below A9o (A2o-A7o mostly 0-35%; A5o reaches 67% only above 150bb), K8o/K9o, Q9o, J9o and T9o, plus Q6s-, T7s and 75s. It limps only 3%, so this is not a limp-heavy strategy either. The SB open size is 2.16bb, the same as every other seat. A raise-only SB strategy normally uses about 3x.
- **CO and BTN fold all offsuit 9x hands** (K9o, Q9o, J9o and T9o at 0% at CO). The BTN, which runs a little high at >150bb, adds K5o-K7o, 76o and 65o (36-65%) and J2s/T4s while folding T8o, J8o, 97o, Q8o, 53s and 74s. Its width is about right, but it is built from the wrong hands.
- **Open size:** about 2.1bb from every 6-max seat, the SB included. 9-handed cash uses 2.4-2.7bb.
- **Other cash table sizes** (outside the given bands, noted against standard charts):
  - 5-handed: the first seat (HJ) opens **14.4%**, the 6-max UTG frequency, where a 5-max first seat is usually about 19-22%. CO 27.7%, BTN 45.8%, SB 33.2% + 5.4% limp.
  - 9-handed: UTG 10.6, UTG+1 10.3, **UTG+2 9.5**, LJ 18.7, HJ 18.0, CO 24.9, BTN 45.0, SB 40.2 + 9.9% limp. The ladder is **not monotonic**: UTG+2 opens less than UTG, and LJ more than HJ.
  - 4-handed: BTN 37.6%. HU SB: 38.8% raise + 6.9% limp, only n=188.

### MTT, 8-handed (28,719) and 9-handed (18,912)

| position | 8h RFI % | 8h avg open | 9h RFI % | 9h avg open | band | verdict | range width (6-9h 25-40bb / 8-9h >80bb grid) |
|---|---:|---:|---:|---:|---|---|---|
| UTG | 13.9% | 2.28 | 12.4% | 2.41 | 17-20 | **LOW in every bucket 15bb+** (11.8-15.1%) | 13.5% / 12.4% |
| UTG+1 | 13.1% | 2.29 | 12.1% | 2.41 | - | about the same as UTG | 11.9% (25-40) |
| UTG+2 | - | - | 12.5% | 2.36 | - | about the same as UTG | - |
| LJ | 23.5% | 2.30 | 21.1% | 2.35 | - | **as wide as HJ** (the ladder flattens) | 19.2% (25-40) |
| HJ | 23.7% | 2.33 | 22.9% | 2.37 | 20-24 | in band all stacks; 8h at the band edge at 25bb+ (24.0-24.8% raw) | 21.4% (25-40) |
| CO | 33.8% | 2.34 | 36.4% | 2.36 | 28-32 | **HIGH** (8h 32.1-38.3%, 9h 36.1-36.7% at 40bb+) | 33.5% / 33.2% |
| BTN | 54.6% | 2.51 | 60.7% | 2.36 | 45-55 | **HIGH at 15bb+** (8h 55.0-62.6%, 9h 62.0-62.3%) | 53.7% / **59.5%** |
| SB | 53.8% (+3.1 limp) | 3.05 | 52.3% (+3.3 limp) | 2.77 | - | - | 44.7% (25-40) |

- **UTG LOW (every depth).** The range is the same shape as cash UTG. Pairs 22-55 open 0-25%, 66 27-57%. No suited connectors or gappers (98s, 87s, 76s 0%), K9s/K8s/Q9s/J9s/T9s at 0-10%, A9s-A2s at 0-50%. KJo (60-74%), QJo (36-43%) and KTo (29-44%) are mixed. Reference hands folded take about 6.7 points off a roughly 20% range.
- **CO HIGH.** It opens offsuit wheel aces (A2o-A4o 33-67%) and weak suited hands (K2s, Q2s-Q4s, J3s-J6s) that sit outside a 28-32% CO range, while still folding K9o, Q9o, J9o and T9o at 0%.
- **BTN HIGH, deep.** At 8-9 handed >80bb (59.5% combo-weighted) it opens K3o-K5o (75-83%), Q7o (4/4) and T4s. At 25-40bb its width is in band once card removal is corrected (53.7%). The raw 58.5-62.6% is mostly card removal plus K2o-K6o.
- **The early-position ladder has steps instead of a slope.** UTG = UTG+1 = UTG+2 (about 12-14%), LJ = HJ (about 21-24%), then CO and BTN. A GTO ladder widens by about 1-3 points every seat.
- **Push/fold at 15bb and under is broadly Nash-like**, so it is not graded. 8-handed: UTG 17.1% (14.2% shove), LJ 22.3% (17.6%), HJ 23.0% (17.2%), CO 30.4% (26.0%), BTN 41.4% (30.0%), SB 58.9% (36.1%). The BTN is at the tight end of a 10-15bb shove range. Non-all-in opens in this bucket average 2.2-5bb. Where they are large, the raise is roughly the effective stack, which is an effective shove by the covering stack.
- **Short-handed MTT (HU and 3-max SNGs) are much tighter than any standard chart.** These contexts have no given band; the comparison is against standard HU and 3-max charts.
  - **HU SB/BTN, 7,692 decisions, the largest single MTT context: opens 46.3%** (shove 15.2%, limp 0.9%). By depth: <=15bb 47.8%, 15-25bb **37.3%**, 25-40bb 49.6%, 40-80bb 54.9%. A HU SB normally plays about 80-100% of hands (raise or limp) at 20bb+, and the Nash push range at 10bb is about 55-65%. The horses fold about half their buttons.
  - 3-handed BTN 42.9% and SB 46.6% are also tight against 3-max ante charts (BTN about 50-60%, SB about 55-65%). At 15-25bb the BTN opens only 39.9%.
- **Open size:** about 2.3-2.5bb from UTG to BTN, which is normal for antes. SB averages 2.8-3.1bb.

### Humans (data only)

There are only 545 human unopened decisions in 24h, mostly cash 4-handed (151) and MTT 9-handed (165), so per-position numbers are noise. They limp heavily: cash 4-handed SB limps 51% and raises 17%; cash 6-handed UTG limps 29% (n=24). Their RFI runs well below the horses'. The tables are in section 4.

## Every flagged context

Section 1 below is the full machine list: all cash 6-handed and MTT 8/9-handed position x bucket cells with n >= 100 outside the band. Section 3 has the 13x13 grids with the classes driving each deviation, against approximate reference charts (`REF` in the script; typical published 100bb 6-max and 8-max BB-ante ranges, not solver output). The cells that matter most, in order:

1. **Cash 6-max SB LOW** (31.2%, n=3,505). Folds A2o-A8o, K8o/K9o, Q9o-T9o.
2. **MTT HU SB LOW** (46.3%, n=7,692; outside the given bands). Folds about half the buttons at every depth.
3. **MTT UTG LOW** (8h 13.9% / 9h 12.4%, n=11,213). No small pairs, no suited connectors, no K9s/Q9s/J9s.
4. **MTT 8-9h CO HIGH** (33.8% / 36.4%). Adds A2o-A4o and weak suited Kx/Qx/Jx.
5. **MTT 8-9h BTN HIGH at 15bb+** (55-63% raw, 59.5% weighted deep). Adds K2o-K5o and Q7o.
6. **Cash 6-max UTG LOW at 60-150bb** (14.1%) and **every 6-max seat LOW under 60bb**. In-band totals hide the missing suited connectors and small pairs.
7. **Cash 6-max BTN marginally HIGH raw** (48.4%; 47.2% weighted, so in band). Width right, composition off (K5o-K7o, 65o, 76o in; T8o, J8o, 97o out).

---

- Window: `[2026-10-30 20:40+00:00, 2026-10-31 20:40+00:00)` (hand_history.created_at, UTC). Serving engine at measurement: `eed06fe5`.
- Horse stream: minutes :10-:30 of every hour (24 blocks, 33% of the window); inside a block every hand with 4+ dealt players and a 25% hash sample (abs(hashtext(id)) % 100 < 25) of 2-3 handed hands; 49,130 nlh hands scanned, 48,909 with a usable unopened decision (3 statements, elapsed 00:00:10, 00:00:18, 00:00:19).
- Human stream: every `has_human` nlh hand in the window, not sampled: 1,022 hands, 1,005 used; only non-horse seats counted.

## 1. Horse contexts outside the comparison bands (n >= 100)

Bands apply to cash 6-handed and MTT 8-9 handed, by the given position; MTT buckets under 25bb are push/fold and are not graded here.

| context | position | RFI % | n | band | verdict |
|---|---|---:|---:|---|---|
| cash 6-handed, all stacks | BTN | 48.4% | 6,780 | 40-48 | **HIGH** |
| cash 6-handed, all stacks | SB | 31.2% | 3,505 | 40-50 | **LOW** |
| cash 6-handed, <60bb | UTG | 12.5% | 728 | 15-18 | **LOW** |
| cash 6-handed, <60bb | HJ | 18.8% | 575 | 19-23 | **LOW** |
| cash 6-handed, <60bb | CO | 20.6% | 433 | 26-30 | **LOW** |
| cash 6-handed, <60bb | SB | 33.3% | 309 | 40-50 | **LOW** |
| cash 6-handed, 60-150bb | UTG | 14.1% | 2,299 | 15-18 | **LOW** |
| cash 6-handed, 60-150bb | SB | 29.2% | 969 | 40-50 | **LOW** |
| cash 6-handed, >150bb | BTN | 49.6% | 5,182 | 40-48 | **HIGH** |
| cash 6-handed, >150bb | SB | 31.8% | 2,227 | 40-50 | **LOW** |
| MTT 8-handed, all stacks | UTG | 13.9% | 7,117 | 17-20 | **LOW** |
| MTT 8-handed, all stacks | CO | 33.8% | 3,103 | 28-32 | **HIGH** |
| MTT 8-handed, 25-40bb | UTG | 11.8% | 1,077 | 17-20 | **LOW** |
| MTT 8-handed, 25-40bb | HJ | 24.8% | 593 | 20-24 | **HIGH** |
| MTT 8-handed, 25-40bb | CO | 36.3% | 433 | 28-32 | **HIGH** |
| MTT 8-handed, 25-40bb | BTN | 60.9% | 281 | 45-55 | **HIGH** |
| MTT 8-handed, 40-80bb | UTG | 12.9% | 1,423 | 17-20 | **LOW** |
| MTT 8-handed, 40-80bb | HJ | 24.4% | 776 | 20-24 | **HIGH** |
| MTT 8-handed, 40-80bb | CO | 32.1% | 551 | 28-32 | **HIGH** |
| MTT 8-handed, 40-80bb | BTN | 62.6% | 361 | 45-55 | **HIGH** |
| MTT 8-handed, >80bb | UTG | 12.7% | 1,987 | 17-20 | **LOW** |
| MTT 8-handed, >80bb | HJ | 24.0% | 1,095 | 20-24 | **HIGH** |
| MTT 8-handed, >80bb | CO | 38.3% | 826 | 28-32 | **HIGH** |
| MTT 8-handed, >80bb | BTN | 61.2% | 508 | 45-55 | **HIGH** |
| MTT 9-handed, all stacks | UTG | 12.4% | 4,096 | 17-20 | **LOW** |
| MTT 9-handed, all stacks | CO | 36.4% | 1,669 | 28-32 | **HIGH** |
| MTT 9-handed, all stacks | BTN | 60.7% | 1,063 | 45-55 | **HIGH** |
| MTT 9-handed, 25-40bb | UTG | 12.5% | 144 | 17-20 | **LOW** |
| MTT 9-handed, 40-80bb | UTG | 13.4% | 612 | 17-20 | **LOW** |
| MTT 9-handed, 40-80bb | CO | 36.1% | 230 | 28-32 | **HIGH** |
| MTT 9-handed, 40-80bb | BTN | 62.0% | 163 | 45-55 | **HIGH** |
| MTT 9-handed, >80bb | UTG | 11.8% | 2,930 | 17-20 | **LOW** |
| MTT 9-handed, >80bb | CO | 36.7% | 1,171 | 28-32 | **HIGH** |
| MTT 9-handed, >80bb | BTN | 62.3% | 735 | 45-55 | **HIGH** |

## 2. Horses: RFI by position, table size and effective stack

### Horses, cash

Unopened decisions by table size (players dealt): 2-handed 188, 3-handed 552, 4-handed 942, 5-handed 10,064, 6-handed 46,014, 7-handed 2,469, 8-handed 2,318, 9-handed 17,296

**cash, 3-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| BTN | 352 | 152 | 43.2% | 0.0% | 0.0% | 2.51 | 190 |  |
| SB | 200 | 91 | 45.5% | 10.0% | 0.0% | 2.63 | 168 |  |

**cash, 4-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| CO | 440 | 125 | 28.4% | 0.0% | 0.0% | 2.49 | 209 |  |
| BTN | 311 | 117 | 37.6% | 0.0% | 0.0% | 2.52 | 201 |  |
| SB | 191 | 65 | 34.0% | 13.6% | 0.0% | 2.71 | 192 |  |

**cash, 4-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <60 | 60-150 | >150 |
|---|---|---|---|
| CO | 25.0% n=16 (2.55bb) | 41.2% n=34 (2.56bb) | 27.4% n=390 (2.47bb) |
| BTN | 30.0% n=10 (2.77bb) | 48.4% n=31 (2.63bb) | 36.7% n=270 (2.49bb) |
| SB | 37.5% n=8 (3.13bb) | 25.8% n=31 (L 9.7%, 2.70bb) | 35.5% n=152 (L 15.1%, 2.69bb) |

**cash, 5-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| HJ | 3,580 | 514 | 14.4% | 0.0% | 0.2% | 2.22 | 247 |  |
| CO | 3,066 | 850 | 27.7% | 0.0% | 0.2% | 2.16 | 231 |  |
| BTN | 2,216 | 1,014 | 45.8% | 0.0% | 0.1% | 2.17 | 210 |  |
| SB | 1,202 | 399 | 33.2% | 5.4% | 0.2% | 2.33 | 183 |  |

**cash, 5-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <60 | 60-150 | >150 |
|---|---|---|---|
| HJ | 19.0% n=153 (shove 4.6%, 2.03bb) | 13.3% n=570 (2.21bb) | 14.3% n=2,857 (2.24bb) |
| CO | 23.9% n=113 (shove 5.3%, 2.02bb) | 26.3% n=499 (2.09bb) | 28.2% n=2,454 (2.17bb) |
| BTN | 44.2% n=77 (shove 2.6%, 2.05bb) | 40.3% n=404 (2.12bb) | 47.1% n=1,735 (2.18bb) |
| SB | 33.8% n=74 (L 2.7%, shove 2.7%, 2.24bb) | 34.0% n=365 (L 5.8%, 2.28bb) | 32.8% n=763 (L 5.5%, 2.36bb) |

**cash, 6-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 14,169 | 2,163 | 15.3% | 0.0% | 0.1% | 2.11 | 252 | in band (15-18) |
| HJ | 12,001 | 2,445 | 20.4% | 0.0% | 0.1% | 2.13 | 247 | in band (19-23) |
| CO | 9,559 | 2,775 | 29.0% | 0.0% | 0.2% | 2.07 | 230 | in band (26-30) |
| BTN | 6,780 | 3,279 | 48.4% | 0.0% | 0.1% | 2.08 | 208 | **HIGH** (band 40-48) |
| SB | 3,505 | 1,095 | 31.2% | 2.9% | 0.3% | 2.16 | 185 | **LOW** (band 40-50) |

**cash, 6-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <60 | 60-150 | >150 |
|---|---|---|---|
| UTG | 12.5% **LOW** n=728 (L 0.1%, shove 1.9%, 2.05bb) | 14.1% **LOW** n=2,299 (2.08bb) | 15.7% n=11,142 (2.12bb) |
| HJ | 18.8% **LOW** n=575 (shove 1.9%, 2.08bb) | 20.1% n=1,978 (2.09bb) | 20.5% n=9,448 (2.14bb) |
| CO | 20.6% **LOW** n=433 (L 0.5%, shove 3.9%, 2.00bb) | 27.3% n=1,587 (2.05bb) | 29.9% n=7,539 (2.08bb) |
| BTN | 40.6% n=318 (shove 3.1%, 2.05bb) | 45.2% n=1,280 (2.06bb) | 49.6% **HIGH** n=5,182 (2.08bb) |
| SB | 33.3% **LOW** n=309 (L 1.9%, shove 3.2%, 2.13bb) | 29.2% **LOW** n=969 (L 3.0%, 2.15bb) | 31.8% **LOW** n=2,227 (L 3.0%, 2.17bb) |

**cash, 7-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 625 | 81 | 13.0% | 0.0% | 0.5% | 2.71 | 217 |  |
| LJ | 544 | 74 | 13.6% | 0.0% | 0.0% | 2.70 | 211 |  |
| HJ | 470 | 84 | 17.9% | 0.0% | 0.0% | 2.69 | 209 |  |
| CO | 386 | 94 | 24.4% | 0.0% | 0.0% | 2.49 | 207 |  |
| BTN | 292 | 140 | 47.9% | 0.0% | 0.7% | 2.52 | 197 |  |
| SB | 152 | 64 | 42.1% | 9.2% | 0.0% | 2.70 | 180 |  |

**cash, 7-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <60 | 60-150 | >150 |
|---|---|---|---|
| UTG | 20.0% n=15 (shove 20.0%) | 13.2% n=121 (2.52bb) | 12.7% n=489 (2.76bb) |
| LJ | 0.0% n=13 | 11.9% n=109 (2.28bb) | 14.5% n=422 (2.79bb) |
| HJ | 28.6% n=7 (2.40bb) | 22.8% n=101 (2.46bb) | 16.3% n=362 (2.80bb) |
| CO | 16.7% n=6 (2.00bb) | 21.3% n=75 (2.17bb) | 25.2% n=305 (2.56bb) |
| BTN | 66.7% n=6 (shove 33.3%, 2.20bb) | 47.0% n=66 (2.21bb) | 47.7% n=220 (2.61bb) |
| SB | 20.0% n=5 (3.00bb) | 42.9% n=56 (L 7.1%, 2.38bb) | 42.9% n=91 (L 11.0%, 2.89bb) |

**cash, 8-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 520 | 54 | 10.4% | 0.0% | 0.2% | 2.72 | 222 |  |
| UTG+1 | 466 | 53 | 11.4% | 0.0% | 0.0% | 2.59 | 221 |  |
| LJ | 413 | 79 | 19.1% | 0.0% | 0.0% | 2.56 | 214 |  |
| HJ | 334 | 62 | 18.6% | 0.0% | 0.3% | 2.62 | 215 |  |
| CO | 272 | 66 | 24.3% | 0.0% | 0.4% | 2.37 | 205 |  |
| BTN | 206 | 99 | 48.1% | 0.0% | 0.0% | 2.43 | 195 |  |
| SB | 107 | 38 | 35.5% | 14.0% | 0.0% | 2.61 | 161 |  |

**cash, 8-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <60 | 60-150 | >150 |
|---|---|---|---|
| UTG | 6.7% n=15 (shove 6.7%) | 8.3% n=96 (2.41bb) | 11.0% n=409 (2.77bb) |
| UTG+1 | 18.8% n=16 (2.20bb) | 9.0% n=89 (2.26bb) | 11.6% n=361 (2.68bb) |
| LJ | 26.7% n=15 (2.17bb) | 17.3% n=81 (2.36bb) | 19.2% n=317 (2.63bb) |
| HJ | 33.3% n=9 (shove 11.1%, 2.50bb) | 7.5% n=67 (2.36bb) | 20.9% n=258 (2.65bb) |
| CO | 25.0% n=8 (shove 12.5%, 2.00bb) | 21.6% n=51 (2.30bb) | 24.9% n=213 (2.39bb) |
| BTN | 42.9% n=7 (2.33bb) | 32.6% n=43 (2.24bb) | 52.6% n=156 (2.47bb) |
| SB | 28.6% n=7 (L 14.3%, 2.15bb) | 31.7% n=41 (L 12.2%, 2.47bb) | 39.0% n=59 (L 15.3%, 2.73bb) |

**cash, 9-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 3,419 | 361 | 10.6% | 0.0% | 0.0% | 2.63 | 229 |  |
| UTG+1 | 3,058 | 314 | 10.3% | 0.0% | 0.0% | 2.57 | 227 |  |
| UTG+2 | 2,744 | 262 | 9.5% | 0.0% | 0.1% | 2.55 | 228 |  |
| LJ | 2,482 | 465 | 18.7% | 0.0% | 0.2% | 2.60 | 224 |  |
| HJ | 2,016 | 362 | 18.0% | 0.0% | 0.0% | 2.56 | 215 |  |
| CO | 1,653 | 412 | 24.9% | 0.0% | 0.2% | 2.48 | 212 |  |
| BTN | 1,240 | 558 | 45.0% | 0.0% | 0.2% | 2.46 | 200 |  |
| SB | 684 | 275 | 40.2% | 9.9% | 0.4% | 2.61 | 174 |  |

**cash, 9-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <60 | 60-150 | >150 |
|---|---|---|---|
| UTG | 5.1% n=136 (shove 0.7%, 2.17bb) | 8.9% n=573 (2.39bb) | 11.2% n=2,710 (2.67bb) |
| UTG+1 | 5.9% n=119 (shove 0.8%, 2.23bb) | 9.9% n=524 (2.41bb) | 10.6% n=2,415 (2.62bb) |
| UTG+2 | 8.2% n=98 (shove 3.1%, 2.44bb) | 10.5% n=449 (2.39bb) | 9.4% n=2,197 (2.59bb) |
| LJ | 17.4% n=92 (shove 5.4%, 2.38bb) | 22.3% n=390 (2.41bb) | 18.1% n=2,000 (2.65bb) |
| HJ | 16.4% n=73 (shove 1.4%, 2.38bb) | 20.6% n=360 (2.43bb) | 17.4% n=1,583 (2.60bb) |
| CO | 20.3% n=64 (shove 4.7%, 2.28bb) | 22.9% n=253 (2.28bb) | 25.5% n=1,336 (2.51bb) |
| BTN | 35.4% n=48 (shove 6.2%, 2.29bb) | 41.0% n=244 (2.35bb) | 46.5% n=948 (2.50bb) |
| SB | 26.5% n=49 (L 10.2%, shove 6.1%, 2.49bb) | 40.8% n=184 (L 10.3%, 2.51bb) | 41.5% n=451 (L 9.8%, 2.66bb) |

### Horses, MTT

Unopened decisions by table size (players dealt): 2-handed 7,692, 3-handed 3,269, 4-handed 348, 5-handed 1,365, 6-handed 2,863, 7-handed 10,695, 8-handed 28,719, 9-handed 18,912

**MTT, 2-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| SB (=BTN, HU) | 7,692 | 3,563 | 46.3% | 0.9% | 15.2% | 4.49 | 22 |  |

**MTT, 2-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| SB | 47.8% n=3,346 (L 0.3%, shove 28.9%, 7.96bb) | 37.3% n=2,104 (L 0.9%, shove 9.6%, 4.72bb) | 49.6% n=998 (L 1.9%, 2.49bb) | 54.9% n=1,243 (L 2.2%, 2.54bb) | 100.0% n=1 (2.50bb) |

**MTT, 3-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| BTN | 2,089 | 897 | 42.9% | 0.4% | 18.4% | 5.05 | 21 |  |
| SB | 1,180 | 550 | 46.6% | 0.7% | 24.6% | 7.85 | 17 |  |

**MTT, 3-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| BTN | 35.8% n=1,272 (L 0.6%, shove 26.7%, 11.93bb) | 39.9% n=293 (L 0.3%, shove 15.4%, 5.94bb) | 57.8% n=251 (2.34bb) | 65.4% n=269 (2.40bb) | 75.0% n=4 (2.43bb) |
| SB | 47.4% n=843 (L 0.2%, shove 30.7%, 11.19bb) | 43.4% n=159 (shove 19.5%, 6.88bb) | 46.1% n=89 (L 4.5%, 2.47bb) | 44.3% n=88 (L 2.3%, 2.51bb) | 100.0% n=1 (2.70bb) |

**MTT, 4-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| CO | 164 | 44 | 26.8% | 0.6% | 4.9% | 2.23 | 73 |  |
| BTN | 119 | 54 | 45.4% | 0.0% | 17.6% | 3.51 | 73 |  |
| SB | 65 | 28 | 43.1% | 1.5% | 16.9% | 3.66 | 70 |  |

**MTT, 5-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| HJ | 505 | 79 | 15.6% | 0.2% | 4.0% | 2.40 | 112 |  |
| CO | 425 | 145 | 34.1% | 0.0% | 9.2% | 2.88 | 118 |  |
| BTN | 280 | 124 | 44.3% | 0.0% | 12.5% | 3.04 | 138 |  |
| SB | 155 | 77 | 49.7% | 2.6% | 13.5% | 3.80 | 134 |  |

**MTT, 5-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| HJ | 17.7% n=141 (shove 14.2%, 2.28bb) | 15.0% n=127 (2.23bb) | 15.7% n=89 (2.53bb) | 16.7% n=60 (L 1.7%, 2.46bb) | 12.5% n=88 (2.54bb) |
| CO | 34.0% n=141 (shove 27.7%, 9.13bb) | 41.4% n=99 (2.17bb) | 30.8% n=65 (2.32bb) | 33.3% n=45 (2.54bb) | 28.0% n=75 (2.34bb) |
| BTN | 42.9% n=91 (shove 31.9%, 4.29bb) | 40.0% n=65 (shove 9.2%, 4.35bb) | 50.0% n=40 (2.24bb) | 63.3% n=30 (2.45bb) | 37.0% n=54 (2.46bb) |
| SB | 59.3% n=59 (L 3.4%, shove 33.9%, 5.27bb) | 28.6% n=35 (shove 2.9%, 5.78bb) | 68.8% n=16 (L 6.2%, 2.46bb) | 50.0% n=12 (2.72bb) | 45.5% n=33 (L 3.0%, 2.56bb) |

**MTT, 6-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 921 | 158 | 17.2% | 0.0% | 5.0% | 2.35 | 35 |  |
| HJ | 762 | 173 | 22.7% | 0.0% | 6.3% | 2.50 | 35 |  |
| CO | 590 | 204 | 34.6% | 0.0% | 11.5% | 2.72 | 34 |  |
| BTN | 386 | 182 | 47.2% | 0.0% | 14.5% | 3.23 | 31 |  |
| SB | 204 | 111 | 54.4% | 2.9% | 19.6% | 3.82 | 23 |  |

**MTT, 6-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| UTG | 16.2% n=352 (shove 13.1%, 2.75bb) | 19.1% n=209 (2.24bb) | 14.3% n=168 (2.36bb) | 22.5% n=120 (2.32bb) | 13.9% n=72 (2.42bb) |
| HJ | 22.3% n=283 (shove 17.0%, 3.85bb) | 21.0% n=162 (2.21bb) | 27.7% n=159 (2.36bb) | 22.1% n=95 (2.38bb) | 17.5% n=63 (2.27bb) |
| CO | 32.9% n=243 (shove 28.0%, 7.98bb) | 36.3% n=124 (2.16bb) | 40.5% n=111 (2.20bb) | 30.8% n=65 (2.23bb) | 29.8% n=47 (2.35bb) |
| BTN | 36.7% n=166 (shove 28.9%, 6.76bb) | 54.7% n=75 (shove 10.7%, 4.15bb) | 51.5% n=66 (2.19bb) | 52.2% n=46 (2.19bb) | 66.7% n=33 (2.50bb) |
| SB | 58.8% n=119 (L 3.4%, shove 30.3%, 5.43bb) | 34.2% n=38 (L 2.6%, shove 10.5%, 2.14bb) | 57.1% n=28 (L 3.6%, 2.36bb) | 50.0% n=10 (2.48bb) | 77.8% n=9 (2.44bb) |

**MTT, 7-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 2,973 | 473 | 15.9% | 0.1% | 5.0% | 2.32 | 50 |  |
| LJ | 2,498 | 431 | 17.3% | 0.1% | 5.4% | 2.32 | 49 |  |
| HJ | 2,063 | 475 | 23.0% | 0.0% | 7.3% | 2.39 | 50 |  |
| CO | 1,587 | 553 | 34.8% | 0.1% | 11.8% | 2.50 | 46 |  |
| BTN | 1,036 | 495 | 47.8% | 0.2% | 16.8% | 2.67 | 41 |  |
| SB | 538 | 279 | 51.9% | 3.0% | 18.4% | 3.50 | 32 |  |

**MTT, 7-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| UTG | 18.1% n=1,059 (L 0.1%, shove 14.0%, 2.69bb) | 15.0% n=638 (2.23bb) | 15.2% n=573 (L 0.2%, 2.33bb) | 13.6% n=440 (2.21bb) | 14.4% n=263 (2.31bb) |
| LJ | 18.6% n=912 (L 0.1%, shove 14.9%, 2.91bb) | 16.7% n=540 (L 0.2%, 2.19bb) | 15.4% n=468 (2.26bb) | 18.0% n=361 (2.23bb) | 15.7% n=217 (2.38bb) |
| HJ | 24.9% n=790 (L 0.1%, shove 19.1%, 3.24bb) | 18.6% n=446 (2.19bb) | 20.6% n=378 (2.24bb) | 26.4% n=269 (2.24bb) | 25.6% n=180 (2.36bb) |
| CO | 35.3% n=629 (L 0.2%, shove 29.7%, 5.77bb) | 34.6% n=373 (2.17bb) | 30.7% n=274 (2.11bb) | 33.5% n=185 (2.18bb) | 44.4% n=126 (2.19bb) |
| BTN | 41.8% n=467 (L 0.4%, shove 30.2%, 4.98bb) | 43.4% n=219 (shove 15.1%, 2.39bb) | 55.6% n=169 (2.14bb) | 64.3% n=115 (2.16bb) | 56.1% n=66 (2.14bb) |
| SB | 54.3% n=311 (L 1.9%, shove 29.9%, 5.02bb) | 45.8% n=96 (L 6.2%, shove 6.2%, 2.52bb) | 45.2% n=62 (L 3.2%, 2.22bb) | 50.0% n=46 (L 4.3%, 2.30bb) | 65.2% n=23 (2.44bb) |

**MTT, 8-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 7,117 | 991 | 13.9% | 0.0% | 3.2% | 2.28 | 102 | **LOW** (band 17-20) |
| UTG+1 | 6,126 | 804 | 13.1% | 0.1% | 2.9% | 2.29 | 104 |  |
| LJ | 5,319 | 1,248 | 23.5% | 0.0% | 4.1% | 2.30 | 104 |  |
| HJ | 4,069 | 966 | 23.7% | 0.0% | 4.3% | 2.33 | 103 | in band (20-24) |
| CO | 3,103 | 1,049 | 33.8% | 0.0% | 6.9% | 2.34 | 101 | **HIGH** (band 28-32) |
| BTN | 2,055 | 1,123 | 54.6% | 0.1% | 11.1% | 2.51 | 94 | in band (45-55) |
| SB | 930 | 500 | 53.8% | 3.1% | 16.0% | 3.05 | 80 |  |

**MTT, 8-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| UTG | 17.1% n=1,602 (L 0.1%, shove 14.2%, 2.21bb) | 15.1% n=1,028 (2.22bb) | 11.8% **LOW** n=1,077 (L 0.1%, 2.24bb) | 12.9% **LOW** n=1,423 (2.24bb) | 12.7% **LOW** n=1,987 (2.38bb) |
| UTG+1 | 16.0% n=1,356 (L 0.2%, shove 12.9%, 2.37bb) | 13.2% n=908 (2.23bb) | 11.5% n=925 (2.21bb) | 11.5% n=1,221 (L 0.1%, 2.27bb) | 12.8% n=1,716 (2.37bb) |
| LJ | 22.3% n=1,230 (L 0.1%, shove 17.6%, 2.51bb) | 23.1% n=766 (2.23bb) | 20.5% n=791 (L 0.1%, 2.24bb) | 24.0% n=1,037 (2.24bb) | 25.8% n=1,495 (2.37bb) |
| HJ | 23.0% n=1,019 (L 0.1%, shove 17.2%, 2.90bb) | 22.7% n=586 (2.22bb) | 24.8% **HIGH** n=593 (2.24bb) | 24.4% **HIGH** n=776 (2.24bb) | 24.0% **HIGH** n=1,095 (2.37bb) |
| CO | 30.4% n=828 (shove 26.0%, 5.12bb) | 31.6% n=465 (2.27bb) | 36.3% **HIGH** n=433 (2.18bb) | 32.1% **HIGH** n=551 (2.14bb) | 38.3% **HIGH** n=826 (2.23bb) |
| BTN | 41.4% n=607 (L 0.3%, shove 30.0%, 5.04bb) | 55.0% n=298 (shove 15.8%, 3.00bb) | 60.9% **HIGH** n=281 (2.15bb) | 62.6% **HIGH** n=361 (2.13bb) | 61.2% **HIGH** n=508 (2.23bb) |
| SB | 58.9% n=377 (L 1.6%, shove 36.1%, 4.82bb) | 46.2% n=145 (L 4.8%, shove 9.0%, 3.10bb) | 46.2% n=104 (L 6.7%, 2.21bb) | 48.8% n=125 (L 4.8%, 2.25bb) | 57.0% n=179 (L 1.7%, 2.39bb) |

**MTT, 9-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 4,096 | 508 | 12.4% | 0.0% | 0.7% | 2.41 | 262 | **LOW** (band 17-20) |
| UTG+1 | 3,588 | 434 | 12.1% | 0.0% | 0.7% | 2.41 | 263 |  |
| UTG+2 | 3,146 | 393 | 12.5% | 0.0% | 0.6% | 2.36 | 263 |  |
| LJ | 2,757 | 583 | 21.1% | 0.0% | 0.8% | 2.35 | 266 |  |
| HJ | 2,174 | 498 | 22.9% | 0.0% | 1.0% | 2.37 | 264 | in band (20-24) |
| CO | 1,669 | 608 | 36.4% | 0.0% | 2.2% | 2.36 | 262 | **HIGH** (band 28-32) |
| BTN | 1,063 | 645 | 60.7% | 0.0% | 3.2% | 2.36 | 263 | **HIGH** (band 45-55) |
| SB | 419 | 219 | 52.3% | 3.3% | 3.6% | 2.77 | 256 |  |

**MTT, 9-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)

| position | <=15 | 15-25 | 25-40 | 40-80 | >80 |
|---|---|---|---|---|---|
| UTG | 15.7% n=242 (shove 12.0%, 2.20bb) | 14.9% n=168 (2.23bb) | 12.5% **LOW** n=144 (L 0.7%, 2.31bb) | 13.4% **LOW** n=612 (2.19bb) | 11.8% **LOW** n=2,930 (L 0.0%, 2.48bb) |
| UTG+1 | 14.8% n=223 (L 0.4%, shove 10.8%, 2.20bb) | 14.5% n=138 (2.19bb) | 10.2% n=127 (2.29bb) | 11.9% n=519 (2.36bb) | 11.9% n=2,581 (2.44bb) |
| UTG+2 | 15.5% n=187 (shove 10.2%, 2.20bb) | 9.5% n=116 (2.18bb) | 9.1% n=121 (2.32bb) | 11.9% n=446 (2.28bb) | 12.7% n=2,276 (2.39bb) |
| LJ | 20.4% n=167 (shove 12.6%, 2.25bb) | 20.2% n=104 (2.21bb) | 15.0% n=107 (2.22bb) | 23.2% n=397 (2.21bb) | 21.2% n=1,982 (2.40bb) |
| HJ | 18.4% n=147 (L 0.7%, shove 15.0%, 2.20bb) | 26.5% n=83 (2.17bb) | 26.4% n=87 (2.17bb) | 21.6% n=301 (2.24bb) | 23.2% n=1,556 (2.42bb) |
| CO | 33.1% n=130 (shove 27.7%, 8.36bb) | 39.7% n=58 (2.20bb) | 36.2% n=80 (2.19bb) | 36.1% **HIGH** n=230 (2.18bb) | 36.7% **HIGH** n=1,171 (2.32bb) |
| BTN | 39.1% n=87 (shove 27.6%, 5.55bb) | 65.9% n=44 (shove 22.7%, 3.02bb) | 67.6% n=34 (2.22bb) | 62.0% **HIGH** n=163 (2.17bb) | 62.3% **HIGH** n=735 (2.31bb) |
| SB | 58.0% n=50 (shove 30.0%, 5.73bb) | 50.0% n=18 (L 5.6%, 5.19bb) | 52.6% n=19 (L 10.5%, 2.02bb) | 50.0% n=56 (2.23bb) | 51.8% n=276 (L 4.0%, 2.48bb) |

## 3. Horse 13x13 open grids

Cell = open % / unopened decisions with that class (`(r/n)` when n < 3, `.` when none). Rows are the first card; upper right suited, lower left offsuit, diagonal pairs. Class from `ca_hand_facts.hand_class` (hash-joined on hand_id, user_id). "Combo-weighted" re-weights each class by its 4/6/12 combos so a class dealt more or less often than expected does not move the total.

### cash 6-handed, 60-150bb, UTG: 325/2,299 opens = 14.1% raw, 14.1% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/7 | 100/6 | 100/6 | 100/13 | 100/6 | 29/7 | 12/8 | 17/6 | (0/1) | 67/6 | 50/4 | 50/4 | 33/12 |
| **K** | 100/21 | 100/9 | 100/5 | 100/11 | 100/6 | 0/8 | 0/7 | 0/12 | 0/7 | 0/13 | 0/7 | 0/6 | 0/7 |
| **Q** | 100/24 | 100/32 | 100/10 | 100/7 | 100/6 | 0/10 | (0/2) | 0/7 | 0/6 | 0/10 | 0/5 | 0/7 | 0/6 |
| **J** | 100/22 | 94/17 | 65/17 | 100/12 | 88/8 | 0/4 | 0/5 | 0/3 | 0/9 | 0/8 | 0/9 | 0/5 | 0/5 |
| **T** | 87/23 | 29/21 | 8/25 | 20/20 | 100/6 | 0/9 | 0/7 | 0/8 | 0/8 | 0/4 | 0/9 | 0/5 | 0/10 |
| **9** | 0/19 | 0/21 | 0/21 | 0/18 | 0/25 | 100/6 | 0/12 | 0/12 | 0/5 | 0/8 | 0/7 | 0/12 | 0/5 |
| **8** | 0/22 | 0/24 | 0/18 | 0/21 | 0/19 | 0/16 | 100/8 | 0/11 | 0/8 | 0/3 | 0/9 | 0/5 | 0/7 |
| **7** | 0/15 | 0/21 | 0/22 | 0/17 | 0/21 | 0/20 | 0/17 | 100/10 | 0/7 | 0/7 | 0/6 | 0/4 | 0/6 |
| **6** | 0/24 | 0/26 | 0/20 | 0/21 | 0/16 | 0/16 | 0/21 | 0/20 | 47/15 | 0/3 | 0/9 | 0/3 | 0/7 |
| **5** | 0/17 | 0/20 | 0/19 | 0/19 | 0/20 | 0/22 | 0/22 | 0/24 | 0/17 | 17/6 | 0/5 | 0/8 | 0/6 |
| **4** | 0/20 | 0/22 | 0/21 | 0/21 | 0/20 | 0/23 | 0/20 | 0/26 | 0/22 | 0/23 | 8/12 | 0/10 | 0/5 |
| **3** | 0/20 | 0/24 | 0/25 | 0/18 | 0/24 | 0/27 | 0/21 | 0/18 | 0/21 | 0/24 | 0/19 | 0/12 | 0/6 |
| **2** | 0/18 | 0/19 | 0/19 | 0/22 | 0/26 | 0/25 | 0/16 | 0/15 | 0/18 | 0/27 | 0/22 | 0/24 | 14/7 |

Against the reference range (19.8% of combos): opens outside it add about 0.0 points, reference hands folded take away about 5.5 points.
- In the reference but mostly folded (open/n): 33 0/12, 44 1/12, 22 1/7, 55 1/6, QJo 11/17, K9s 0/8, Q9s 0/10, J9s 0/4, T9s 0/9, 98s 0/12, 87s 0/11, 76s 0/7, A8s 1/8, A7s 1/6

### cash 6-handed, 60-150bb, HJ: 397/1,978 opens = 20.1% raw, 19.4% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/11 | 100/6 | 100/6 | 100/11 | 100/3 | 100/7 | 100/7 | 100/6 | 80/5 | 100/7 | 100/6 | 100/4 | 100/7 |
| **K** | 100/13 | 100/10 | 100/5 | 100/4 | 100/10 | 33/3 | 11/9 | 0/6 | 0/7 | 0/4 | 0/5 | 0/12 | 0/6 |
| **Q** | 100/21 | 100/22 | 100/10 | 100/10 | 100/6 | (0/2) | (0/2) | 0/12 | 0/6 | 0/8 | 0/4 | 0/4 | 0/6 |
| **J** | 100/22 | 100/17 | 100/18 | 100/8 | 100/5 | 22/9 | 0/6 | 0/7 | 0/11 | 0/6 | 0/5 | 0/7 | 0/5 |
| **T** | 100/23 | 100/14 | 64/22 | 57/30 | 100/8 | 100/4 | (0/2) | 0/7 | 0/7 | 0/8 | 0/8 | 0/7 | 0/4 |
| **9** | 0/16 | 0/16 | 0/13 | 0/20 | 0/15 | 100/6 | 33/6 | 0/3 | 0/5 | 0/9 | 0/7 | 0/3 | 0/11 |
| **8** | 0/18 | 0/23 | 0/12 | 0/19 | 0/14 | 0/12 | 100/6 | 0/3 | 0/7 | 0/5 | 0/5 | 0/8 | 0/8 |
| **7** | 0/13 | 0/15 | 0/25 | 0/10 | 0/20 | 0/13 | 0/18 | 100/6 | 0/4 | 0/3 | (0/2) | 0/5 | 0/5 |
| **6** | 0/21 | 0/19 | 0/18 | 0/14 | 0/14 | 0/24 | 0/22 | 0/28 | 100/10 | 0/4 | 0/6 | 0/4 | 0/7 |
| **5** | 0/16 | 0/15 | 0/15 | 0/20 | 0/20 | 0/18 | 0/12 | 0/21 | 0/22 | 83/6 | 0/5 | 0/9 | 0/7 |
| **4** | 0/20 | 0/24 | 0/15 | 0/18 | 0/14 | 0/17 | 0/15 | 0/20 | 0/18 | 0/16 | 55/11 | 0/9 | 0/4 |
| **3** | 6/18 | 0/22 | 0/15 | 0/24 | 0/19 | 0/20 | 0/14 | 0/21 | 0/21 | 0/15 | 0/14 | 50/6 | 0/5 |
| **2** | 0/21 | 0/22 | 0/13 | 0/18 | 0/17 | 0/29 | 0/10 | 0/13 | 0/20 | 0/17 | 0/10 | 0/16 | 25/8 |

Against the reference range (24.6% of combos): opens outside it add about 0.0 points, reference hands folded take away about 4.5 points.
- In the reference but mostly folded (open/n): A9o 0/16, JTo 17/30, 22 2/8, QTo 14/22, K7s 0/6, 87s 0/3, 76s 0/4, 65s 0/4, K8s 1/9, J9s 2/9, 33 3/6, 44 6/11, K9s 1/3, 98s 2/6

### cash 6-handed, 60-150bb, CO: 434/1,587 opens = 27.3% raw, 26.8% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/10 | 100/7 | 100/3 | 100/5 | 100/6 | 100/6 | 100/7 | (2/2) | 100/4 | 100/4 | 100/8 | 100/6 | 100/3 |
| **K** | 100/11 | 100/6 | 100/9 | (2/2) | 100/7 | 100/5 | 100/3 | 89/9 | 83/6 | 67/6 | 25/4 | 0/6 | 25/4 |
| **Q** | 100/23 | 100/15 | 100/6 | 100/5 | 100/7 | 88/8 | 20/5 | 50/8 | 20/5 | 20/5 | 0/8 | 11/9 | 0/3 |
| **J** | 100/16 | 100/10 | 100/12 | 100/9 | 100/6 | 100/5 | 50/4 | 33/3 | 33/6 | 25/4 | (0/1) | 0/11 | 0/3 |
| **T** | 100/8 | 100/19 | 100/14 | 100/14 | 100/5 | 100/4 | (1/2) | 0/5 | 0/6 | 0/3 | 0/4 | 0/3 | 0/5 |
| **9** | 43/7 | 0/24 | 0/10 | 0/11 | 0/6 | 100/10 | 100/6 | 14/7 | 0/8 | 0/4 | (0/1) | 0/5 | 0/3 |
| **8** | 56/9 | 0/11 | 0/15 | 0/13 | 0/18 | 0/15 | (2/2) | 100/3 | (0/2) | 0/6 | 0/3 | 0/7 | 0/3 |
| **7** | 54/13 | 0/21 | 0/18 | 0/20 | 0/19 | 0/12 | 0/21 | 100/10 | 33/3 | 0/4 | 0/6 | 0/7 | 0/5 |
| **6** | 27/11 | 0/27 | 0/16 | 0/13 | 0/12 | 0/18 | 0/13 | 0/8 | 100/4 | 100/5 | 0/5 | 0/3 | 0/4 |
| **5** | 6/16 | 0/17 | 0/14 | 0/15 | 0/14 | 0/10 | 0/22 | 0/9 | 0/20 | 100/10 | 56/9 | 0/3 | 0/6 |
| **4** | 7/14 | 0/13 | 0/17 | 0/18 | 0/16 | 0/18 | 0/18 | 0/11 | 0/7 | 0/13 | 100/8 | 0/4 | 0/3 |
| **3** | 12/16 | 0/14 | 0/10 | 0/14 | 0/14 | 0/15 | 0/15 | 0/15 | 0/13 | 0/13 | 0/15 | 100/8 | (0/1) |
| **2** | 15/13 | 0/7 | 0/7 | 0/13 | 0/16 | 0/14 | 0/16 | 0/14 | 0/8 | 0/18 | 0/11 | 0/12 | 80/5 |

Against the reference range (34.8% of combos): opens outside it add about 0.0 points, reference hands folded take away about 8.2 points.
- In the reference but mostly folded (open/n): K9o 0/24, Q9o 0/10, J9o 0/11, T9o 0/6, A5o 1/16, A9o 3/7, A7o 7/13, A8o 5/9, T7s 0/5, 75s 0/4, 97s 1/7, Q8s 1/5, Q6s 1/5, K4s 1/4

### cash 6-handed, 60-150bb, BTN: 579/1,280 opens = 45.2% raw, 44.3% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/6 | 100/5 | 100/4 | 100/7 | (2/2) | 100/3 | 100/4 | (2/2) | 100/7 | 100/4 | 100/3 | 100/5 | 100/6 |
| **K** | 100/14 | 100/4 | 100/9 | 100/4 | 100/6 | 100/3 | 100/4 | 100/4 | 100/5 | 100/3 | 100/4 | 100/3 | 100/3 |
| **Q** | 100/12 | 100/10 | 100/5 | 100/6 | 100/4 | 100/5 | 100/6 | 100/5 | 100/9 | 100/4 | 100/5 | 100/3 | (1/2) |
| **J** | 100/9 | 100/14 | 100/10 | 100/5 | 100/3 | 100/5 | 100/6 | 100/4 | 100/3 | 75/4 | (2/2) | (2/2) | 80/5 |
| **T** | 100/10 | 100/13 | 100/11 | 100/16 | 100/7 | (2/2) | (2/2) | 67/3 | 40/5 | (0/1) | (0/1) | 33/3 | 0/5 |
| **9** | 100/15 | 75/4 | 23/22 | 73/11 | 79/14 | 100/4 | 100/3 | 100/3 | 20/5 | 0/7 | 0/5 | 0/7 | (0/2) |
| **8** | 100/14 | 69/16 | 12/8 | 0/6 | 0/17 | 88/8 | 100/7 | 100/4 | (2/2) | 17/6 | 0/7 | 0/3 | 0/3 |
| **7** | 100/8 | 67/15 | 13/15 | 0/11 | 0/14 | 0/6 | 56/9 | 100/9 | 100/4 | (2/2) | 0/4 | 17/6 | . |
| **6** | 100/7 | 11/9 | 0/14 | 0/15 | 0/11 | 0/7 | 0/10 | 29/7 | 100/7 | 100/8 | (2/2) | 0/4 | 0/5 |
| **5** | 100/14 | 17/12 | 0/7 | 0/8 | 0/14 | 0/7 | 0/9 | 0/11 | 8/12 | (2/2) | 100/4 | 14/7 | 0/5 |
| **4** | 92/13 | 13/15 | 0/6 | 0/13 | 0/11 | 0/18 | 0/8 | 0/8 | 0/19 | 10/10 | (1/1) | 0/3 | 0/3 |
| **3** | 100/7 | 0/7 | 0/10 | 0/15 | 0/13 | 0/11 | 0/8 | 0/6 | 0/11 | 0/8 | 0/11 | 100/9 | 0/6 |
| **2** | 92/13 | 0/10 | 0/12 | 0/20 | 0/14 | 0/12 | 0/12 | 0/11 | 0/13 | 0/8 | 0/10 | 0/12 | 100/8 |

Against the reference range (50.2% of combos): opens outside it add about 0.8 points, reference hands folded take away about 6.7 points.
- Opened though outside the reference (open/n): K7o 10/15, J2s 4/5
- In the reference but mostly folded (open/n): J8o 0/6, T8o 0/17, 97o 0/6, Q8o 1/8, Q9o 5/22, 87o 5/9, 95s 0/7, 74s 0/4, 63s 0/4, 43s 0/3, 53s 1/7, 85s 1/6, 96s 1/5, T6s 2/5

### cash 6-handed, 60-150bb, SB: 283/969 opens = 29.2% raw, 27.7% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/3 | 100/4 | (2/2) | (2/2) | 100/7 | (1/1) | (2/2) | (1/1) | (2/2) | 100/3 | 100/3 | 100/4 | (2/2) |
| **K** | 100/9 | 100/3 | 100/7 | 100/3 | 100/3 | 67/3 | 100/3 | 75/4 | (1/1) | 50/4 | 57/7 | 67/3 | . |
| **Q** | 100/10 | 100/11 | 100/3 | (1/1) | 100/3 | 75/4 | (0/1) | (1/2) | 0/3 | 20/5 | 33/3 | (1/2) | (0/1) |
| **J** | 100/12 | 100/15 | 100/9 | 100/7 | (2/2) | (2/2) | . | (1/2) | 20/5 | . | 25/8 | 17/6 | (1/2) |
| **T** | 100/8 | 100/11 | 100/5 | 90/10 | 100/6 | 100/4 | (1/2) | 0/3 | 0/3 | (0/1) | (0/1) | 0/3 | (0/2) |
| **9** | 83/12 | 0/7 | 0/5 | 0/10 | 9/11 | 100/5 | (2/2) | 40/5 | 0/3 | 0/4 | 0/5 | 0/4 | 0/6 |
| **8** | 50/8 | 8/13 | 0/8 | 0/9 | 0/10 | 11/9 | 100/5 | (1/2) | (1/2) | 0/3 | 0/4 | 0/4 | 0/3 |
| **7** | 38/8 | 0/4 | 0/7 | 0/10 | 0/11 | 0/8 | 10/10 | 100/3 | 62/8 | 20/5 | 0/3 | 0/3 | (0/1) |
| **6** | 20/5 | 8/13 | 0/9 | 0/10 | 0/8 | 0/11 | 0/8 | 0/13 | 100/4 | (2/2) | 0/5 | 0/4 | (0/2) |
| **5** | 27/11 | 0/14 | 0/4 | 0/11 | 0/11 | 0/5 | 0/4 | 0/5 | 0/6 | 100/4 | (0/2) | (0/1) | (0/2) |
| **4** | 22/9 | 0/10 | 0/15 | 0/9 | 0/11 | 0/17 | 0/5 | 0/9 | 0/4 | 0/9 | 80/5 | . | (0/1) |
| **3** | 7/14 | 0/6 | 0/5 | 0/3 | 0/9 | 0/8 | 0/6 | 0/10 | 0/9 | 0/9 | 0/8 | 100/3 | 0/4 |
| **2** | 0/7 | 0/12 | 0/8 | 0/5 | 0/5 | 0/7 | 0/9 | 0/9 | 0/10 | 0/4 | 0/8 | 0/5 | 50/4 |

Against the reference range (41.8% of combos): opens outside it add about 0.0 points, reference hands folded take away about 12.5 points.
- In the reference but mostly folded (open/n): K9o 0/7, Q9o 0/5, J9o 0/10, A2o 0/7, A3o 1/14, K8o 1/13, T9o 1/11, A6o 1/5, A4o 2/9, A5o 3/11, A7o 3/8, A8o 4/8, Q6s 0/3, T7s 0/3

### cash 6-handed, >150bb, CO: 670/2,207 opens = 30.4% raw, 29.2% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/5 | 100/9 | 100/4 | 100/6 | 100/6 | 100/3 | 100/7 | 100/7 | 100/10 | 100/4 | 100/12 | 100/11 | 100/4 |
| **K** | 100/32 | 100/9 | 100/7 | 100/9 | 100/4 | 100/7 | 86/7 | 100/7 | 75/8 | 40/5 | 89/9 | 80/5 | 11/9 |
| **Q** | 100/22 | 100/23 | 100/16 | 100/5 | 100/6 | 43/7 | 57/7 | 45/11 | 58/12 | 50/4 | 11/9 | 0/4 | 0/7 |
| **J** | 100/21 | 100/23 | 100/29 | 100/8 | 100/7 | 100/6 | 62/8 | 62/8 | 71/7 | 14/7 | 50/10 | 0/8 | 0/7 |
| **T** | 100/12 | 100/19 | 100/21 | 100/26 | 100/13 | 100/6 | 25/4 | 0/5 | 0/6 | 0/5 | 0/9 | 0/6 | 0/5 |
| **9** | 63/19 | 0/20 | 0/27 | 0/17 | 0/15 | 100/12 | 100/11 | 25/8 | (0/2) | 0/5 | 0/6 | 0/8 | 0/8 |
| **8** | 76/21 | 0/21 | 0/19 | 0/31 | 0/20 | 0/21 | 100/12 | 100/3 | 67/6 | 0/12 | 0/7 | 0/4 | 0/3 |
| **7** | 74/23 | 0/30 | 0/15 | 0/14 | 0/18 | 0/13 | 0/27 | 100/4 | 86/7 | 20/5 | 0/9 | 0/7 | 0/3 |
| **6** | 28/29 | 0/30 | 0/20 | 0/21 | 0/17 | 0/20 | 0/11 | 0/17 | 100/10 | 100/4 | 0/6 | 0/6 | 0/4 |
| **5** | 33/15 | 0/22 | 0/22 | 0/16 | 0/18 | 0/17 | 0/10 | 0/14 | 0/31 | 100/5 | 86/7 | 0/9 | 0/6 |
| **4** | 31/13 | 0/14 | 0/23 | 0/21 | 0/12 | 0/18 | 0/16 | 0/20 | 0/8 | 0/29 | 100/10 | 0/7 | 0/11 |
| **3** | 21/19 | 0/21 | 0/25 | 0/19 | 0/13 | 0/15 | 0/24 | 0/10 | 0/21 | 0/23 | 0/24 | 100/7 | 0/7 |
| **2** | 14/21 | 0/28 | 0/18 | 0/19 | 0/26 | 0/16 | 0/23 | 0/19 | 0/15 | 0/14 | 0/23 | 0/23 | 100/7 |

Against the reference range (34.8% of combos): opens outside it add about 0.8 points, reference hands folded take away about 6.6 points.
- Opened though outside the reference (open/n): K3s 4/5, J6s 5/7, Q5s 2/4, J4s 5/10
- In the reference but mostly folded (open/n): K9o 0/20, Q9o 0/27, J9o 0/17, T9o 0/15, A5o 5/15, A9o 12/19, T7s 0/5, 75s 1/5, T8s 1/4, 97s 2/8, K5s 2/5, Q9s 3/7, Q7s 5/11, Q8s 4/7

### cash 6-handed, >150bb, BTN: 718/1,499 opens = 47.9% raw, 47.2% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/8 | 100/4 | 100/6 | 100/4 | 100/6 | 100/3 | (2/2) | 100/6 | 100/5 | 100/3 | 100/5 | (1/1) | 100/5 |
| **K** | 100/16 | 100/3 | 100/4 | 100/6 | 100/7 | 100/9 | (1/1) | 100/3 | 100/4 | 100/3 | 100/6 | (1/2) | 100/8 |
| **Q** | 100/16 | 100/11 | 100/4 | (2/2) | 100/4 | 100/6 | 100/5 | 100/4 | 100/3 | 100/5 | 100/4 | 100/6 | 100/6 |
| **J** | 100/20 | 100/18 | 100/15 | 100/6 | 100/4 | 100/6 | 100/3 | 100/7 | (2/2) | (2/2) | 100/5 | (2/2) | 75/4 |
| **T** | 100/18 | 100/16 | 100/11 | 100/13 | 100/5 | 100/11 | 100/7 | (0/1) | 50/4 | 33/3 | 50/4 | 0/3 | 0/4 |
| **9** | 90/10 | 94/18 | 47/17 | 67/9 | 92/12 | 100/8 | 100/10 | 100/5 | 14/7 | 25/4 | 0/6 | 0/5 | 0/5 |
| **8** | 100/14 | 92/13 | 18/17 | 5/20 | 0/15 | 100/14 | 100/8 | 100/5 | 100/4 | 67/3 | (0/1) | 0/5 | (0/2) |
| **7** | 100/15 | 50/10 | 14/21 | 0/11 | 0/16 | 8/13 | 92/13 | 100/7 | 100/6 | 100/5 | 0/4 | 0/5 | 0/7 |
| **6** | 100/16 | 65/17 | 10/10 | 0/14 | 0/12 | 0/11 | 0/12 | 60/15 | 100/5 | (1/1) | 100/4 | (0/2) | (0/1) |
| **5** | 100/10 | 36/14 | 0/19 | 0/18 | 0/24 | 0/14 | 0/14 | 0/10 | 50/8 | 100/5 | (2/2) | 0/7 | 0/3 |
| **4** | 100/11 | 21/14 | 0/9 | 0/15 | 0/19 | 0/16 | 0/11 | 0/16 | 0/7 | 6/18 | 100/8 | 0/3 | 0/4 |
| **3** | 100/13 | 15/13 | 0/7 | 0/10 | 0/16 | 0/17 | 0/9 | 0/19 | 0/10 | 0/11 | 0/19 | 100/5 | (0/2) |
| **2** | 100/18 | 11/9 | 0/10 | 0/14 | 0/16 | 0/5 | 0/9 | 0/9 | 0/17 | 0/20 | 0/9 | 0/17 | 100/6 |

Against the reference range (50.2% of combos): opens outside it add about 2.7 points, reference hands folded take away about 5.4 points.
- Opened though outside the reference (open/n): K6o 11/17, 76o 9/15, K7o 5/10, 65o 4/8, K5o 5/14, J2s 3/4, T4s 2/4
- In the reference but mostly folded (open/n): T8o 0/15, J8o 1/20, 97o 1/13, Q8o 3/17, Q9o 8/17, 74s 0/4, 53s 0/7, 43s 0/3, 96s 1/7, 95s 1/4, T6s 2/4

### cash 6-handed, >150bb, SB: 206/661 opens = 31.2% raw, 30.1% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/3 | (1/1) | (2/2) | 100/4 | (2/2) | . | (1/1) | 100/6 | (2/2) | (2/2) | 100/3 | (1/1) | (2/2) |
| **K** | 100/7 | (2/2) | 100/4 | (2/2) | (2/2) | (1/1) | (1/1) | 100/3 | (1/2) | 67/3 | (1/1) | 67/3 | (1/2) |
| **Q** | 100/7 | 100/9 | 100/4 | (2/2) | (1/1) | (2/2) | . | (0/2) | 0/3 | . | (0/1) | (0/2) | (1/1) |
| **J** | 100/10 | 100/4 | 100/9 | 100/5 | (2/2) | (1/1) | (1/2) | (1/2) | . | . | . | . | (1/2) |
| **T** | 100/9 | 100/6 | 100/10 | 100/7 | 100/3 | . | (1/1) | (0/2) | (0/2) | 0/5 | . | 0/3 | (0/1) |
| **9** | 80/5 | 0/6 | 0/6 | 20/5 | 0/7 | (2/2) | 100/3 | (0/2) | (0/1) | . | 0/3 | (0/2) | 0/7 |
| **8** | 67/6 | 17/6 | 0/6 | 0/3 | 0/3 | 20/5 | (1/1) | . | (0/1) | (0/2) | 0/3 | (0/2) | (0/2) |
| **7** | 50/4 | 0/8 | 0/8 | 0/9 | 0/6 | 0/8 | 17/6 | 100/3 | 67/3 | (0/2) | 0/3 | 0/3 | (0/2) |
| **6** | 25/4 | 0/3 | 0/5 | 0/7 | 0/7 | 0/9 | 0/4 | 0/3 | 100/5 | 67/3 | (0/1) | (0/1) | . |
| **5** | 67/6 | 0/4 | 0/5 | 0/6 | 0/5 | 0/5 | 0/12 | 0/6 | 0/6 | (2/2) | . | (0/2) | . |
| **4** | 33/12 | 0/4 | 0/15 | 0/9 | 0/7 | 0/7 | 0/7 | 0/6 | 0/4 | 0/6 | 100/4 | . | . |
| **3** | 25/4 | 0/6 | 0/3 | 0/7 | 0/5 | . | 0/6 | 0/5 | 0/5 | 0/5 | 0/6 | (1/1) | . |
| **2** | 20/5 | 0/12 | 0/7 | 0/7 | 0/7 | 0/4 | 0/9 | 0/5 | 0/5 | 0/5 | 0/4 | 0/8 | (2/2) |

Against the reference range (41.8% of combos): opens outside it add about 0.0 points, reference hands folded take away about 7.6 points.
- In the reference but mostly folded (open/n): K9o 0/6, Q9o 0/6, T9o 0/7, K8o 1/6, J9o 1/5, A2o 1/5, A6o 1/4, A3o 1/4, A4o 4/12, A7o 2/4, Q6s 0/3

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, UTG: 256/1,962 opens = 13.0% raw, 13.5% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/10 | 100/8 | (2/2) | 100/5 | 100/4 | (2/2) | 12/8 | 17/12 | 33/6 | 40/5 | 20/5 | 33/3 | 25/4 |
| **K** | 100/23 | 100/9 | 100/8 | 100/5 | 100/3 | 10/10 | 0/7 | 0/6 | 0/7 | 0/7 | 0/3 | 0/7 | 0/5 |
| **Q** | 100/23 | 88/17 | 100/9 | (2/2) | (1/2) | 0/6 | 0/5 | 0/6 | 0/4 | 0/4 | 0/5 | 0/8 | 0/7 |
| **J** | 100/13 | 60/15 | 36/22 | 100/10 | 75/8 | 0/6 | 0/5 | 0/3 | 0/4 | 0/9 | 0/7 | 0/4 | 0/9 |
| **T** | 94/17 | 44/16 | 14/14 | 0/16 | 100/8 | 0/6 | 0/7 | 0/7 | 0/8 | 0/6 | 0/8 | 0/9 | 0/5 |
| **9** | 0/23 | 0/10 | 0/22 | 0/21 | 0/16 | 100/10 | 0/7 | 0/5 | 0/8 | . | 0/7 | 0/7 | 0/6 |
| **8** | 0/19 | 0/16 | 0/23 | 0/16 | 0/15 | 0/10 | 100/10 | 0/4 | (0/1) | 0/5 | 0/13 | 0/5 | 0/8 |
| **7** | 0/17 | 0/18 | 0/23 | 0/22 | 0/22 | 0/25 | 0/13 | 89/9 | 0/9 | 0/5 | 0/4 | 0/5 | 0/4 |
| **6** | 0/15 | 0/10 | 0/15 | 0/12 | 0/20 | 0/19 | 0/18 | 0/21 | 57/7 | 0/3 | (0/2) | 0/6 | 0/4 |
| **5** | 0/17 | 0/10 | 0/17 | 0/18 | 0/21 | 0/14 | 0/15 | 0/21 | 0/24 | 25/16 | 0/4 | 0/5 | 0/6 |
| **4** | 0/23 | 0/15 | 0/18 | 0/15 | 0/15 | 0/22 | 0/17 | 0/16 | 0/22 | 0/22 | 0/7 | 0/5 | 0/3 |
| **3** | 0/18 | 0/14 | 0/18 | 0/23 | 0/19 | 0/19 | 0/16 | 0/20 | 0/18 | 0/21 | 0/20 | 11/9 | 0/3 |
| **2** | 0/17 | 0/22 | 0/9 | 0/17 | 0/28 | 0/18 | 0/20 | 0/26 | 0/11 | 0/17 | 0/17 | 0/19 | 0/6 |

Against the reference range (20.1% of combos): opens outside it add about 0.4 points, reference hands folded take away about 6.7 points.
- Opened though outside the reference (open/n): KTo 7/16
- In the reference but mostly folded (open/n): QJo 8/22, 44 0/7, 22 0/6, 33 1/9, KJo 9/15, 55 4/16, K8s 0/7, Q9s 0/6, J9s 0/6, T9s 0/6, 98s 0/7, 87s 0/4, 76s 0/9, K9s 1/10

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, UTG+1: 119/1,052 opens = 11.3% raw, 11.9% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/10 | . | 100/6 | 100/6 | 100/5 | 25/4 | (0/1) | (0/1) | (0/2) | 0/3 | (1/2) | (0/1) | 25/4 |
| **K** | 100/6 | 100/3 | 100/3 | (2/2) | 33/3 | (0/2) | 0/3 | (0/1) | (0/2) | 0/3 | 0/5 | 0/3 | 0/4 |
| **Q** | 100/12 | (2/2) | 100/5 | 100/6 | 67/3 | (0/2) | 0/3 | (0/1) | 0/3 | 0/4 | (0/2) | (0/1) | (0/2) |
| **J** | 100/5 | 62/8 | 67/6 | 100/3 | 60/5 | 0/3 | (0/1) | 0/3 | (0/2) | 0/3 | (0/2) | 0/5 | (0/1) |
| **T** | 67/9 | 14/14 | 0/16 | 12/8 | 100/5 | (0/2) | 0/6 | (0/1) | 0/3 | (0/2) | 0/6 | 0/5 | (0/2) |
| **9** | 0/10 | 0/7 | 0/12 | 0/15 | 0/9 | 100/6 | (0/2) | 0/3 | 0/3 | 0/3 | 0/3 | 0/4 | 0/4 |
| **8** | 0/7 | 0/11 | 0/7 | 0/5 | 0/5 | 0/12 | 100/3 | 0/3 | 0/3 | (0/2) | 0/6 | 0/5 | (0/2) |
| **7** | 0/4 | 0/11 | 0/10 | 0/5 | 0/10 | 0/9 | 0/8 | 67/3 | (0/2) | (0/2) | (0/2) | 0/3 | 0/7 |
| **6** | 0/8 | 0/11 | 0/6 | 0/12 | 0/7 | 0/7 | 0/9 | 0/7 | 20/5 | 0/3 | 0/4 | 0/6 | 0/5 |
| **5** | 0/12 | 0/6 | 0/7 | 0/9 | 0/13 | 0/8 | 0/7 | 0/14 | 0/9 | 14/7 | 0/3 | (0/2) | 0/7 |
| **4** | 0/5 | 0/8 | 0/7 | 0/16 | 0/9 | 0/16 | 0/11 | 0/8 | 0/17 | 0/12 | 0/4 | (0/1) | (0/2) |
| **3** | 0/10 | 0/15 | 0/14 | 0/7 | 0/12 | 0/17 | 0/9 | 0/13 | 0/11 | 0/9 | 0/12 | 0/6 | 0/3 |
| **2** | 0/11 | 0/10 | 0/8 | 0/9 | 0/8 | 0/13 | 0/9 | 0/15 | 0/5 | 0/7 | 0/7 | 0/11 | 0/6 |

Against the reference range (21.3% of combos): opens outside it add about 0.0 points, reference hands folded take away about 5.2 points.
- In the reference but mostly folded (open/n): KTo 2/14, 44 0/4, 33 0/6, 22 0/6, 55 1/7, 66 1/5, KJo 5/8, A5s 0/3, K8s 0/3, J9s 0/3, 87s 0/3, A9s 1/4, A2s 1/4, KTs 1/3

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, UTG+2: 11/121 opens = 9.1% raw, 9.6% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | (1/1) | (1/1) | . | . | . | . | . | (0/2) | . | . | . | . | . |
| **K** | (2/2) | . | . | . | . | (0/1) | (0/2) | (0/1) | . | . | . | . | (0/1) |
| **Q** | (1/1) | (1/1) | (1/1) | (1/1) | (0/1) | (0/1) | (0/1) | . | (0/1) | . | (0/1) | . | . |
| **J** | . | (0/1) | 33/3 | . | . | . | . | (0/1) | (0/1) | . | 0/4 | . | (0/1) |
| **T** | . | (1/2) | . | (0/1) | . | . | (0/2) | . | (0/1) | (0/1) | . | (0/1) | (0/1) |
| **9** | 0/3 | 0/4 | (0/1) | (0/2) | (0/1) | . | (0/1) | . | (0/1) | (0/1) | . | . | . |
| **8** | 0/3 | (0/1) | (0/1) | 0/3 | (0/1) | . | (1/1) | . | (0/1) | . | . | (0/1) | 0/3 |
| **7** | (0/1) | (0/1) | . | (0/1) | (0/1) | (0/2) | (0/1) | . | . | . | . | . | (0/1) |
| **6** | . | . | . | (0/2) | . | (0/1) | . | (0/1) | . | (0/1) | . | . | . |
| **5** | (0/2) | (0/2) | (0/2) | (0/1) | (0/1) | . | (0/1) | (0/1) | . | . | . | . | (0/1) |
| **4** | (0/1) | (0/1) | . | . | . | . | (0/1) | . | . | . | . | . | . |
| **3** | . | (0/1) | (0/2) | . | (0/1) | (0/1) | (0/1) | . | (0/2) | . | . | . | (0/2) |
| **2** | (0/2) | . | 0/3 | . | (0/1) | . | . | (0/2) | (0/2) | (0/1) | (0/1) | (0/1) | (0/2) |

Against the reference range (25.5% of combos): opens outside it add about 0.0 points, reference hands folded take away about 1.5 points.
- In the reference but mostly folded (open/n): A9o 0/3, QJo 1/3

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, LJ: 250/1,366 opens = 18.3% raw, 19.2% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/5 | 100/4 | 100/3 | 100/5 | . | 100/5 | (1/1) | 71/7 | 70/10 | 80/5 | (1/2) | 100/5 | 100/5 |
| **K** | 100/4 | 100/6 | . | 100/4 | (1/1) | 25/8 | 20/5 | (0/1) | (0/2) | (0/2) | 17/6 | 25/4 | (0/2) |
| **Q** | 100/13 | 100/13 | 100/6 | 100/4 | (1/1) | 0/3 | 25/4 | 0/6 | (0/2) | 0/3 | 0/3 | 0/3 | 0/4 |
| **J** | 100/9 | 93/14 | 100/10 | (2/2) | 100/5 | 50/6 | 0/4 | 17/6 | 0/3 | 25/4 | 0/7 | 0/9 | 0/5 |
| **T** | 100/11 | 88/16 | 64/14 | 57/7 | 100/7 | (0/1) | 33/3 | 0/5 | 0/4 | 0/3 | 0/7 | 0/8 | (0/1) |
| **9** | 6/16 | 0/14 | 0/13 | 0/12 | 0/12 | 100/7 | 33/3 | 25/4 | 0/5 | 0/3 | 0/6 | 0/7 | 0/6 |
| **8** | 15/13 | 0/16 | 0/15 | 0/11 | 0/15 | 0/14 | 100/9 | 20/5 | 12/8 | 0/7 | (0/2) | 0/3 | 0/5 |
| **7** | 5/22 | 0/15 | 0/9 | 0/14 | 0/13 | 0/14 | 0/11 | 100/6 | 25/4 | 0/4 | 0/6 | (0/2) | . |
| **6** | 0/11 | 0/12 | 0/11 | 0/8 | 0/12 | 0/9 | 0/13 | 0/11 | (1/2) | 0/3 | 14/7 | 0/4 | 0/5 |
| **5** | 0/11 | 0/13 | 0/8 | 0/12 | 0/15 | 0/13 | 0/4 | 0/10 | 0/9 | 75/8 | 12/8 | 0/7 | (0/1) |
| **4** | 0/13 | 0/7 | 0/12 | 0/11 | 0/14 | 0/10 | 0/8 | 0/11 | 0/7 | 0/7 | 64/11 | 0/6 | 0/5 |
| **3** | 0/13 | 0/15 | 0/15 | 0/22 | 0/15 | 0/10 | 0/14 | 0/13 | 0/10 | 0/15 | 0/12 | 67/3 | 0/3 |
| **2** | 10/10 | 0/17 | 0/13 | 0/10 | 0/14 | 0/16 | 0/20 | 0/14 | 0/13 | 0/9 | 0/19 | 0/7 | 33/6 |

Against the reference range (25.8% of combos): opens outside it add about 0.0 points, reference hands folded take away about 4.9 points.
- In the reference but mostly folded (open/n): A9o 1/16, JTo 4/7, QTo 9/14, Q9s 0/3, J8s 0/4, 65s 0/3, 22 2/6, K8s 1/5, 87s 1/5, K9s 2/8, Q8s 1/4, 97s 1/4, 76s 1/4, T8s 1/3

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, HJ: 292/1,217 opens = 24.0% raw, 21.4% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/4 | (1/1) | 100/4 | 100/4 | 100/4 | 100/4 | 89/9 | 100/9 | 80/5 | 86/7 | 100/7 | 100/5 | 100/3 |
| **K** | 100/12 | 100/5 | (1/1) | 100/5 | 100/5 | 33/9 | 40/5 | 50/8 | 0/5 | (0/1) | 0/5 | (1/2) | 0/7 |
| **Q** | 100/11 | 100/8 | 100/5 | 100/5 | 100/6 | 0/5 | 0/4 | 0/7 | (0/1) | 0/3 | 0/4 | . | 0/4 |
| **J** | 100/13 | 100/8 | 100/12 | 100/8 | 100/3 | 0/4 | (0/1) | 0/4 | 20/5 | 0/3 | 0/5 | 0/3 | 20/5 |
| **T** | 100/10 | 100/9 | 94/16 | 50/8 | 100/6 | 100/5 | (0/2) | 0/3 | (0/2) | 0/4 | (0/1) | 0/6 | 0/3 |
| **9** | 14/7 | 0/8 | 0/12 | 0/8 | 0/16 | 100/7 | 75/4 | 0/10 | 0/5 | 0/3 | (0/2) | (0/1) | (0/2) |
| **8** | 15/13 | 0/14 | 0/6 | 0/6 | 0/11 | 0/11 | 100/5 | (0/1) | (0/2) | (0/2) | 0/5 | . | 0/5 |
| **7** | 14/7 | 0/6 | 0/8 | 0/11 | 0/10 | 0/10 | 0/10 | 100/9 | 80/5 | 0/4 | 0/4 | 0/5 | 0/4 |
| **6** | 0/12 | 0/14 | 0/13 | 0/8 | 0/13 | 0/8 | 0/14 | 0/15 | 100/4 | 0/5 | 0/3 | 0/5 | 0/3 |
| **5** | 0/12 | 0/9 | 0/5 | 0/12 | 0/14 | 0/15 | 0/11 | 0/14 | 0/14 | 100/8 | 25/4 | 0/4 | (0/2) |
| **4** | 8/13 | 0/10 | 0/13 | 0/7 | 0/8 | 0/14 | 0/8 | 0/10 | 0/8 | 0/8 | 89/9 | 0/5 | 0/3 |
| **3** | 0/17 | 0/9 | 0/15 | 0/13 | 0/14 | 0/5 | 0/9 | 0/14 | 0/8 | 0/13 | 0/7 | 75/4 | 0/3 |
| **2** | 0/8 | 0/18 | 0/10 | 0/7 | 0/15 | 0/5 | 0/14 | 0/10 | 0/3 | 0/9 | 0/8 | 0/8 | 57/7 |

Against the reference range (27.3% of combos): opens outside it add about 0.0 points, reference hands folded take away about 4.5 points.
- In the reference but mostly folded (open/n): A9o 1/7, A8o 2/13, JTo 4/8, K6s 0/5, Q9s 0/5, Q8s 0/4, J9s 0/4, 97s 0/10, 65s 0/5, K9s 3/9, 22 4/7, K8s 2/5, K7s 4/8

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, CO: 315/898 opens = 35.1% raw, 33.5% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/3 | 100/3 | 100/4 | (1/1) | 100/4 | (2/2) | . | 100/3 | (2/2) | 100/6 | 100/3 | (2/2) | . |
| **K** | 100/12 | 100/10 | (2/2) | (2/2) | . | 100/3 | (1/1) | (2/2) | 100/4 | (2/2) | (2/2) | 100/3 | 67/6 |
| **Q** | 100/9 | 100/9 | . | 100/3 | (1/1) | 80/5 | (2/2) | 100/7 | 100/5 | (0/2) | 67/3 | 33/3 | 75/4 |
| **J** | 100/7 | 100/9 | 100/9 | 100/8 | 100/6 | (1/1) | 100/4 | . | (1/1) | 100/6 | . | 75/4 | 25/4 |
| **T** | 100/9 | 100/6 | 100/3 | 100/8 | 100/3 | 100/3 | 75/4 | 0/4 | (0/2) | (0/2) | (0/2) | 0/4 | (0/2) |
| **9** | 89/9 | 0/11 | 0/4 | 0/3 | 29/7 | 100/4 | (2/2) | (0/1) | 0/3 | (0/2) | (0/1) | 0/5 | 0/3 |
| **8** | 100/7 | 17/6 | 0/9 | 0/11 | 0/9 | 0/8 | 100/4 | 100/5 | . | 0/3 | (0/2) | (0/2) | 0/4 |
| **7** | 88/8 | 7/15 | 0/5 | 0/7 | 0/8 | 0/8 | 10/10 | 100/6 | (2/2) | 50/4 | 0/6 | (0/1) | (0/1) |
| **6** | 78/9 | 0/10 | 0/9 | 0/9 | 0/9 | 0/4 | 0/9 | 17/6 | (2/2) | (1/1) | 0/4 | . | 0/3 |
| **5** | 60/5 | 0/8 | 0/7 | 0/14 | 0/6 | 0/6 | 0/3 | 0/5 | 0/12 | (2/2) | . | (0/1) | 0/4 |
| **4** | 62/13 | 0/15 | 0/6 | 0/9 | 0/4 | 0/16 | 0/5 | 0/14 | 0/7 | 0/8 | 100/5 | (0/1) | (0/2) |
| **3** | 67/9 | 0/13 | 0/7 | 0/12 | 0/7 | 0/9 | 0/8 | 0/9 | 0/8 | 0/9 | 0/4 | 100/7 | . |
| **2** | 50/6 | 0/9 | 0/7 | 0/7 | 0/3 | 0/10 | 0/6 | 0/7 | 0/7 | 0/9 | 0/6 | 0/12 | (2/2) |

Against the reference range (37.0% of combos): opens outside it add about 2.8 points, reference hands folded take away about 4.8 points.
- Opened though outside the reference (open/n): A3o 6/9, A4o 8/13, A2o 3/6, J5s 6/6, Q2s 3/4, J3s 3/4, K2s 4/6, Q4s 2/3
- In the reference but mostly folded (open/n): K9o 0/11, Q9o 0/4, J9o 0/3, T9o 2/7, A5o 3/5, T7s 0/4, 96s 0/3, 64s 0/4, 75s 2/4

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, BTN: 322/550 opens = 58.5% raw, 53.7% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/4 | (2/2) | 100/3 | (1/1) | 100/3 | 100/4 | 100/5 | (1/1) | (1/1) | 100/4 | 100/3 | . | 100/3 |
| **K** | 100/4 | (1/1) | (2/2) | (1/1) | (2/2) | (1/1) | (1/1) | 100/4 | (2/2) | . | (1/1) | (1/1) | (2/2) |
| **Q** | 100/4 | 100/6 | (2/2) | (1/1) | 100/3 | (2/2) | (2/2) | (1/1) | . | (2/2) | . | 100/5 | (1/1) |
| **J** | 100/8 | (2/2) | 100/6 | 100/4 | 100/5 | (1/1) | (1/1) | . | 100/3 | . | (2/2) | 100/4 | 100/3 |
| **T** | 100/7 | 100/4 | 100/6 | 100/5 | 100/3 | 100/3 | (1/1) | 67/3 | 100/3 | (0/2) | (0/2) | (0/1) | 33/3 |
| **9** | 100/5 | 100/7 | (1/1) | 100/4 | 100/4 | 100/4 | (2/2) | 100/3 | (1/1) | (0/1) | (0/2) | (1/2) | (1/2) |
| **8** | 100/8 | 91/11 | 67/3 | (1/1) | 33/6 | (2/2) | 100/6 | . | . | 67/3 | (0/2) | 50/4 | (0/1) |
| **7** | 100/5 | 67/6 | 33/3 | (0/2) | (0/2) | 0/7 | 60/5 | (1/1) | (1/1) | (1/1) | . | (0/1) | (1/2) |
| **6** | 100/3 | 62/8 | 33/6 | (0/2) | (0/2) | 17/6 | 17/6 | 67/6 | 100/6 | (2/2) | (1/1) | (0/1) | . |
| **5** | 100/7 | (1/2) | 29/7 | 20/5 | (0/1) | (0/1) | 0/5 | (0/2) | (1/1) | 100/3 | 100/3 | 67/3 | . |
| **4** | (1/1) | 40/5 | 25/4 | 0/7 | 0/5 | 0/3 | 0/5 | 0/8 | 12/8 | 0/3 | (1/1) | 60/5 | 0/3 |
| **3** | 100/8 | 67/3 | (0/2) | 0/10 | (0/2) | (0/1) | 0/5 | 0/3 | 0/3 | 0/3 | 0/6 | (2/2) | (1/2) |
| **2** | 100/4 | 50/8 | (0/2) | 0/5 | 0/5 | 0/4 | 0/8 | 0/8 | (0/2) | 0/6 | 0/6 | 0/4 | 100/3 |

Against the reference range (53.8% of combos): opens outside it add about 1.9 points, reference hands folded take away about 2.3 points.
- Opened though outside the reference (open/n): K3o 2/3, K2o 4/8, K4o 2/5, J2s 3/3, 83s 2/4
- In the reference but mostly folded (open/n): 97o 0/7, T8o 2/6, 87o 3/5, K6o 5/8, 43s 3/5

### MTT 6-9 handed (labels by distance from the button; UTG = first to act), 25-40bb, SB: 102/213 opens = 47.9% raw, 44.7% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | (2/2) | (1/1) | (1/1) | (1/1) | (2/2) | (1/1) | . | (1/1) | . | . | (1/1) | (1/1) | (2/2) |
| **K** | 100/4 | . | . | . | (2/2) | (1/1) | (1/1) | . | . | . | . | (1/1) | (1/1) |
| **Q** | 100/3 | (2/2) | (2/2) | (1/1) | . | . | (1/1) | . | (1/1) | (1/1) | . | (2/2) | . |
| **J** | (1/1) | . | (1/1) | . | . | (1/1) | . | . | (1/1) | . | . | (1/1) | . |
| **T** | 100/4 | 100/3 | (1/1) | (1/1) | (1/1) | . | (2/2) | . | . | . | (0/1) | . | . |
| **9** | (2/2) | (1/1) | (1/1) | 50/4 | . | (1/1) | . | (1/1) | (0/1) | . | . | . | . |
| **8** | (2/2) | 100/4 | (0/2) | 0/3 | . | . | . | (1/1) | . | . | (0/1) | (0/1) | (0/1) |
| **7** | 100/3 | (0/2) | (0/1) | (0/1) | (0/2) | (0/1) | (2/2) | (1/1) | . | . | (0/1) | . | (0/2) |
| **6** | 100/5 | 50/4 | 25/4 | 0/3 | (0/1) | (0/1) | 25/4 | 67/3 | (1/1) | . | . | . | (0/1) |
| **5** | (1/1) | (0/1) | (1/2) | (0/1) | (0/1) | 0/6 | . | 0/3 | (1/2) | (1/1) | . | . | (0/1) |
| **4** | 100/4 | (1/1) | (0/2) | . | (0/1) | 0/3 | 0/3 | (0/1) | . | (0/2) | (2/2) | . | . |
| **3** | (1/1) | 33/3 | (0/1) | 0/3 | (0/2) | (0/1) | (0/1) | 0/3 | (0/2) | (0/2) | 0/3 | . | . |
| **2** | (2/2) | 0/3 | (0/2) | 0/3 | 0/7 | (0/1) | . | (0/1) | 0/6 | (0/1) | (0/2) | (0/1) | (1/1) |

Against the reference range (44.2% of combos): opens outside it add about 1.1 points, reference hands folded take away about 0.5 points.
- Opened though outside the reference (open/n): 76o 2/3, K6o 2/4
- In the reference but mostly folded (open/n): J9o 2/4

### MTT 8-9 handed, >80bb, UTG: 202/1,703 opens = 11.9% raw, 12.4% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/7 | 100/7 | (1/1) | (2/2) | (2/2) | 0/4 | 10/10 | 20/5 | 10/10 | 33/3 | 38/8 | 50/4 | (0/2) |
| **K** | 100/17 | 100/7 | 100/5 | 100/5 | 50/4 | 0/5 | 0/5 | 0/8 | 0/6 | 0/7 | 0/8 | 0/4 | 0/4 |
| **Q** | 100/12 | 93/14 | 100/6 | 100/5 | 100/4 | 0/3 | 0/4 | 0/4 | 0/6 | 0/6 | (0/2) | 0/4 | 0/6 |
| **J** | 94/16 | 74/19 | 43/14 | 100/7 | 60/5 | 0/4 | 0/10 | 0/4 | (0/2) | 0/6 | 0/7 | 0/3 | (0/2) |
| **T** | 67/12 | 29/14 | 6/17 | 0/15 | 100/11 | 0/3 | 0/6 | 0/5 | 0/4 | 0/5 | 0/4 | 0/4 | 0/8 |
| **9** | 0/22 | 0/21 | 0/17 | 0/13 | 0/22 | 100/9 | 0/7 | 0/4 | 0/6 | 0/4 | 0/7 | 0/4 | 0/7 |
| **8** | 0/17 | 0/16 | 0/16 | 0/17 | 0/12 | 0/13 | 100/9 | (0/2) | 0/9 | 0/3 | 0/5 | 0/4 | 0/8 |
| **7** | 0/24 | 0/15 | 0/14 | 0/11 | 0/15 | 0/14 | 0/14 | 100/8 | 0/8 | 0/4 | 0/6 | 0/11 | 0/6 |
| **6** | 0/15 | 0/10 | 0/12 | 0/21 | 0/17 | 0/9 | 0/12 | 0/16 | 27/11 | 0/4 | 0/4 | 0/3 | 0/7 |
| **5** | 0/11 | 0/12 | 0/8 | 0/17 | 0/23 | 0/19 | 0/13 | 0/18 | 0/10 | 0/5 | 0/8 | (0/1) | 0/8 |
| **4** | 0/19 | 0/16 | 0/17 | 0/19 | 0/14 | 0/19 | 0/19 | 0/8 | 0/19 | 0/14 | 0/7 | 0/3 | 0/5 |
| **3** | 0/17 | 0/16 | 0/12 | 0/22 | 0/16 | 0/22 | 0/13 | 0/21 | 0/10 | 0/4 | 0/17 | 0/5 | 0/6 |
| **2** | 0/13 | 0/8 | 0/13 | 0/17 | 0/17 | 0/20 | 0/14 | 0/24 | 0/13 | 0/18 | 0/15 | 0/13 | 0/7 |

Against the reference range (20.1% of combos): opens outside it add about 0.0 points, reference hands folded take away about 6.7 points.
- In the reference but mostly folded (open/n): QJo 6/14, 55 0/5, 44 0/7, 33 0/5, 22 0/7, 66 3/11, A9s 0/4, K9s 0/5, K8s 0/5, Q9s 0/3, J9s 0/4, T9s 0/3, 98s 0/7, 76s 0/8

### MTT 8-9 handed, >80bb, CO: 246/702 opens = 35.0% raw, 33.2% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | 100/6 | (1/1) | 100/3 | . | (1/1) | (2/2) | . | 100/4 | . | . | (2/2) | (2/2) | (2/2) |
| **K** | 100/10 | 100/5 | 100/3 | (1/1) | (1/1) | (2/2) | . | 100/3 | (1/1) | (2/2) | . | (1/1) | . |
| **Q** | 100/10 | 100/8 | 100/4 | 100/3 | (2/2) | . | 100/3 | (2/2) | 67/3 | (2/2) | 67/3 | (1/2) | (1/2) |
| **J** | 100/12 | 100/7 | 100/3 | 100/3 | 100/3 | 100/3 | (0/1) | 100/5 | 67/3 | . | 0/3 | 0/3 | (1/1) |
| **T** | 100/7 | 100/5 | 100/12 | 100/8 | 100/4 | . | 100/3 | (1/2) | . | (0/1) | 0/3 | 0/3 | (0/2) |
| **9** | 100/6 | 50/6 | 0/10 | 0/4 | 0/4 | 100/3 | (1/1) | . | . | 0/3 | 0/4 | 0/3 | 0/3 |
| **8** | 80/5 | 0/8 | 0/6 | 0/6 | 0/5 | 20/5 | 100/4 | . | 67/3 | (0/1) | 0/5 | (0/1) | (0/2) |
| **7** | (2/2) | 12/8 | 0/7 | 0/9 | 0/4 | 0/7 | 25/4 | (2/2) | . | (1/1) | (0/2) | 0/4 | 0/3 |
| **6** | 86/7 | 0/8 | 0/7 | 0/9 | 0/5 | 0/8 | 0/6 | 25/4 | (2/2) | (2/2) | 33/3 | (0/1) | (0/2) |
| **5** | . | 0/8 | 0/7 | 0/8 | 0/7 | 0/3 | 0/8 | 0/3 | 0/5 | 100/6 | 83/6 | (0/1) | (0/2) |
| **4** | 67/9 | 0/4 | 0/7 | 0/6 | 0/8 | 0/8 | 0/4 | 0/5 | 0/4 | 0/11 | 100/3 | . | 0/4 |
| **3** | 33/9 | 0/3 | 0/10 | 0/6 | 0/8 | 0/7 | 0/3 | 0/7 | 0/5 | 0/4 | 0/8 | 100/3 | 0/3 |
| **2** | 67/6 | 0/9 | 0/7 | 0/8 | 0/5 | 0/6 | 0/5 | 0/10 | 0/5 | 0/5 | 0/8 | 0/5 | (2/2) |

Against the reference range (37.0% of combos): opens outside it add about 1.6 points, reference hands folded take away about 3.4 points.
- Opened though outside the reference (open/n): A4o 6/9, A2o 4/6, Q4s 2/3, J6s 2/3
- In the reference but mostly folded (open/n): Q9o 0/10, J9o 0/4, T9o 0/4, K9o 3/6, 64s 1/3

### MTT 8-9 handed, >80bb, BTN: 272/454 opens = 59.9% raw, 59.5% combo-weighted

| | A | K | Q | J | T | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** | (2/2) | (1/1) | (2/2) | (1/1) | 100/3 | (1/1) | 100/4 | (2/2) | (1/1) | . | . | . | . |
| **K** | 100/7 | (2/2) | (1/1) | (1/1) | (1/1) | (2/2) | 100/4 | (1/1) | (2/2) | (2/2) | (1/1) | . | 100/3 |
| **Q** | 100/4 | 100/4 | . | (1/1) | . | (1/1) | . | 100/3 | (1/1) | (2/2) | (2/2) | (2/2) | (1/1) |
| **J** | 100/4 | (2/2) | 100/9 | 100/3 | (2/2) | (2/2) | . | 100/3 | (2/2) | (2/2) | (1/1) | (1/1) | . |
| **T** | 100/3 | 100/4 | 100/3 | 100/3 | (1/1) | 100/3 | (2/2) | (1/1) | (0/1) | 100/3 | 75/4 | (1/1) | . |
| **9** | 100/3 | 100/11 | (2/2) | . | (2/2) | 100/3 | 100/3 | (1/1) | 80/5 | . | (0/1) | (1/1) | (0/1) |
| **8** | 100/3 | 100/7 | (2/2) | 33/3 | (1/1) | 100/4 | (2/2) | (1/1) | 100/4 | 67/3 | . | (1/1) | (1/1) |
| **7** | 100/5 | (1/1) | 100/4 | . | (0/1) | 50/4 | 100/3 | (1/1) | (1/1) | . | . | . | (0/1) |
| **6** | 100/3 | 100/3 | (1/1) | 25/4 | 0/4 | 0/3 | 20/5 | 100/3 | (2/2) | (2/2) | (1/1) | (2/2) | (0/1) |
| **5** | 100/4 | 83/6 | (1/2) | 8/12 | 0/6 | 0/3 | 0/4 | 17/6 | (2/2) | 100/3 | (2/2) | 25/4 | . |
| **4** | 100/5 | 75/8 | 17/6 | 0/4 | 0/7 | 0/5 | 0/6 | 0/4 | 0/3 | (1/2) | (2/2) | . | . |
| **3** | 100/5 | 75/8 | 0/3 | 0/4 | (0/2) | 0/3 | 0/5 | 0/7 | 0/3 | 0/4 | 0/8 | (2/2) | . |
| **2** | 100/3 | 0/3 | 0/3 | 0/4 | (0/2) | (0/2) | 0/6 | 0/7 | 0/4 | 0/4 | (0/1) | 0/7 | 100/3 |

Against the reference range (53.8% of combos): opens outside it add about 3.2 points, reference hands folded take away about 1.3 points.
- Opened though outside the reference (open/n): Q7o 4/4, K5o 5/6, K4o 6/8, K3o 6/8, T4s 3/4
- In the reference but mostly folded (open/n): J8o 1/3, 97o 2/4, 53s 1/4

## 4. Humans (data only; non-horse seats in has_human hands)

### Humans, cash

Unopened decisions by table size (players dealt): 3-handed 1, 4-handed 151, 5-handed 2, 6-handed 84, 7-handed 14, 9-handed 27

**cash, 4-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| CO | 60 | 14 | 23.3% | 8.3% | 0.0% | 2.14 | 126 |  |
| BTN | 50 | 10 | 20.0% | 4.0% | 0.0% | 2.00 | 126 |  |
| SB | 41 | 7 | 17.1% | 51.2% | 0.0% | 2.71 | 121 |  |

**cash, 6-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 24 | 2 | 8.3% | 29.2% | 0.0% | 3.00 | 127 |  |
| HJ | 21 | 0 | 0.0% | 9.5% | 0.0% | - | 131 |  |
| CO | 13 | 0 | 0.0% | 7.7% | 0.0% | - | 122 |  |
| BTN | 14 | 0 | 0.0% | 14.3% | 0.0% | - | 145 |  |
| SB | 12 | 1 | 8.3% | 50.0% | 0.0% | 3.00 | 123 |  |

**cash, 7-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 3 | 0 | 0.0% | 0.0% | 0.0% | - | 33 |  |
| LJ | 4 | 0 | 0.0% | 25.0% | 0.0% | - | 38 |  |
| HJ | 3 | 0 | 0.0% | 100.0% | 0.0% | - | 42 |  |
| CO | 2 | 0 | 0.0% | 50.0% | 0.0% | - | 43 |  |
| BTN | 2 | 0 | 0.0% | 100.0% | 0.0% | - | 34 |  |

**cash, 9-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 6 | 1 | 16.7% | 16.7% | 16.7% | - | 130 |  |
| UTG+1 | 5 | 0 | 0.0% | 40.0% | 0.0% | - | 111 |  |
| UTG+2 | 5 | 1 | 20.0% | 20.0% | 0.0% | 3.50 | 111 |  |
| LJ | 3 | 0 | 0.0% | 0.0% | 0.0% | - | 100 |  |
| HJ | 4 | 0 | 0.0% | 50.0% | 0.0% | - | 132 |  |
| CO | 2 | 1 | 50.0% | 0.0% | 0.0% | 3.50 | 132 |  |
| BTN | 2 | 0 | 0.0% | 0.0% | 0.0% | - | 70 |  |

### Humans, MTT

Unopened decisions by table size (players dealt): 4-handed 1, 6-handed 5, 7-handed 30, 8-handed 65, 9-handed 165

**MTT, 7-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 8 | 0 | 0.0% | 12.5% | 0.0% | - | 28 |  |
| LJ | 6 | 1 | 16.7% | 16.7% | 16.7% | - | 31 |  |
| HJ | 7 | 1 | 14.3% | 0.0% | 14.3% | - | 23 |  |
| CO | 7 | 3 | 42.9% | 0.0% | 14.3% | 2.50 | 24 |  |
| BTN | 2 | 1 | 50.0% | 0.0% | 0.0% | 2.00 | 22 |  |

**MTT, 8-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 16 | 0 | 0.0% | 0.0% | 0.0% | - | 49 |  |
| UTG+1 | 14 | 1 | 7.1% | 7.1% | 7.1% | - | 61 |  |
| LJ | 13 | 1 | 7.7% | 7.7% | 7.7% | - | 49 |  |
| HJ | 11 | 0 | 0.0% | 0.0% | 0.0% | - | 55 |  |
| CO | 7 | 1 | 14.3% | 0.0% | 14.3% | - | 50 |  |
| BTN | 3 | 2 | 66.7% | 0.0% | 33.3% | 2.50 | 45 |  |
| SB | 1 | 1 | 100.0% | 0.0% | 100.0% | - | 23 |  |

**MTT, 9-handed, all stacks**

| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| UTG | 33 | 1 | 3.0% | 9.1% | 3.0% | - | 182 |  |
| UTG+1 | 31 | 3 | 9.7% | 16.1% | 0.0% | 2.67 | 182 |  |
| UTG+2 | 28 | 4 | 14.3% | 3.6% | 3.6% | 2.50 | 181 |  |
| LJ | 21 | 3 | 14.3% | 9.5% | 0.0% | 2.67 | 120 |  |
| HJ | 19 | 3 | 15.8% | 5.3% | 5.3% | 2.75 | 132 |  |
| CO | 18 | 5 | 27.8% | 5.6% | 0.0% | 2.60 | 242 |  |
| BTN | 11 | 4 | 36.4% | 0.0% | 0.0% | 2.58 | 156 |  |
| SB | 4 | 0 | 0.0% | 0.0% | 0.0% | - | 285 |  |

