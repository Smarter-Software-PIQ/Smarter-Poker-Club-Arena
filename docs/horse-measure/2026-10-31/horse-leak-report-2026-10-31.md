# Hold'em horse leak report, 2026-10-31 (read-only analysis)

Source: `public.horse_hand_reviews`, `game_variant = 'nlh'`, `played_at >= now() - 7 days`
(window 2026-10-24 05:49 UTC to 2026-10-31 05:48 UTC). The table holds only hands with
`|net_bb| >= 20`, so every number below is the big-pot subset (see caveats at the end).

Population in the window: cash 95,044 rows (formats cash 58,418 / lightning_2bb 13,899 /
lightning_1bb 10,591 / lightning_0.5bb 10,130 / hu_cash 2,006; net -90,257 bb) and
tournament 96,341 rows (net +293,613 bb).

Method: a deterministic 12 percent hash sample per segment (cash 11,237 rows, MTT 11,544
rows; the exact count moves by a few rows between calls because the table is live), parsed
with SELECT-only CTEs plus one `pg_temp` hand-class function. Every action carries a
`publicNode` snapshot (pot, toCall, currentBet, stacks), so pot fractions are read from the
engine's own numbers rather than reconstructed. "Weekly" = sampled net x (segment rows /
sampled rows): cash x 8.46, MTT x 8.35. `net` is the whole hand's net_bb for the hands in
the class (the brief's convention), `won` = net_bb > 0. Hand classes: `two_pair_plus` (two
pair or better, incl. trips, straights, flushes), `one_pair:top` (overpair or pair of the
top board card), `one_pair:under` (any lower pair incl. unimproved pocket pair below top),
`draw` (flush draw with a hole card, or 4-to-a-straight, flop/turn only), `air`. Bet size
class = toCall / pot-before-the-bet.

Nothing was written. No production state changed. Scripts: `scripts/horse-measure/leak_pipeline.py`,
raw outputs under `docs/horse-measure/2026-10-31/results/*.json`.

---

## 1. Key table: weekly net by leak class (cash and MTT separately)

| # | Class (horse decision)                                             | Seg  | n (sample) | won | win% | net bb (sample) | avg price            | weekly net bb |
|---|--------------------------------------------------------------------|------|-----------:|----:|-----:|----------------:|----------------------|--------------:|
| 1 | TURN call with one pair facing a bet (not after own bet)           | cash | 1,727      | 570 | 33.0%| -36,436         | 0.76 pot, 19 bb      | **-308,000**  |
|   |   same                                                             | MTT  | 1,542      | 568 | 36.8%| -22,134         | 0.72 pot, 17 bb      | **-185,000**  |
| 2 | FLOP bet, raised, CALL with one pair or air                        | cash | 1,040      | 341 | 32.8%| -28,444         | 0.86 pot, 15 bb      | **-241,000**  |
|   |   same                                                             | MTT  | 805        | 272 | 33.8%| -19,551         | 0.86 pot, 16 bb      | **-163,000**  |
| 3 | TURN bet, raised, CALL or call-all-in with one pair                | cash | 650        | 215 | 33.1%| -21,155         | 0.78 pot, 30-64 bb   | **-179,000**  |
|   |   same                                                             | MTT  | 603        | 217 | 36.0%| -13,307         | 0.70 pot, 26-37 bb   | **-111,000**  |
| 4 | RIVER one-pair bet, raised, CALL or call-all-in (committed branch) | cash | 226        | 27  | 11.9%| -15,306         | 0.72 pot, 43-106 bb  | **-129,000**  |
|   |   same                                                             | MTT  | 125        | 24  | 19.2%| -5,608          | 0.67 pot, 32-45 bb   | **-47,000**   |
| 5 | TURN call with air or a draw (not after own bet)                   | cash | 494        | 146 | 29.6%| -7,337          | 0.72 pot, 16 bb      | **-62,000**   |
|   |   same                                                             | MTT  | 383        | 141 | 36.8%| -2,951          | 0.68 pot, 14 bb      | **-25,000**   |
| 6 | FLOP call vs c-bet with top pair (feeder for 1 and 3)              | cash | 1,188      | 494 | 41.6%| -13,576         | 0.58 pot, 6.4 bb     | -115,000      |
|   |   same                                                             | MTT  | 973        | 446 | 45.8%| -5,431          | 0.57 pot, 6.5 bb     | -45,000       |
| 7 | MTT TURN call-all-in with one pair (included in 1, shown apart)    | MTT  | 490        | 175 | 35.7%| -8,507          | 0.6 pot, 19-34 bb    | -71,000       |
| 8 | Preflop BB 3-bet with broadway vs <=2.5x open                      | cash | 152        | 57  | 37.5%| -2,726          | open 2.1 bb          | -23,000       |
|   |   same                                                             | MTT  | 171        | 79  | 46.2%| -1,249          | open 2.2 bb          | -10,000       |
| 9 | Preflop cold-call suited ace (btn/other/sb)                        | cash | 103        | 49  | 47.6%| -1,784          | 2.4 bb               | -15,000       |
|10 | Preflop jam over a raise with AK-class broadway (cash, 100bb+)     | cash | 56         | 26  | 46.4%| -2,101          | 149 bb eff           | -18,000       |

Classes 1-4 are mutually exclusive (1 excludes hands where the horse bet the turn first;
3 is exactly that branch; 2 and 4 are the same branch on the flop and river). Class 6
overlaps 1 and 3 (it is the entry to them). Class 7 is a subset of 1.

Reference points from the same sample, so the losses above are not "big pots lose":
flop raise vs c-bet with two pair+ (cash n=650, 82% won, +37,309 = +316k/wk; MTT n=567,
82%, +28,191 = +235k/wk); turn raise with two pair+ (cash n=667, 80%, +26,903); BB call vs
open (cash n=2,408, 52%, +17,417; MTT n=2,385, 58%, +21,931). The horses make money with
real hands and lose it calling with one pair.

---

## 2. Detail by requested class

### 2.1 TURN calls by hand class and bet size (first turn decision facing a bet; includes the horse's own-bet-raised hands, split out in 2.4)

Cash (sample 11,237):

| hand class     | size (bet/pot) | n   | won | win%  | net     | avg call bb |
|----------------|----------------|----:|----:|------:|--------:|------------:|
| one_pair:top   | <0.4           | 198 | 100 | 50.5% | +198    | 12.3 |
| one_pair:top   | 0.4-0.7        | 390 | 171 | 43.8% | -5,320  | 19.6 |
| one_pair:top   | 0.7-1.05       | 512 | 148 | 28.9% | -16,744 | 23.4 |
| one_pair:top   | >=1.05         | 199 | 46  | 23.1% | -8,248  | 22.9 |
| one_pair:under | <0.4           | 149 | 54  | 36.2% | -2,285  | 9.5  |
| one_pair:under | 0.4-0.7        | 371 | 115 | 31.0% | -6,700  | 16.9 |
| one_pair:under | 0.7-1.05       | 242 | 50  | 20.7% | -8,339  | 20.9 |
| one_pair:under | >=1.05         | 53  | 10  | 18.9% | -2,409  | 20.7 |
| two_pair_plus  | <0.4           | 124 | 91  | 73.4% | +5,447  | 15.6 |
| two_pair_plus  | 0.4-0.7        | 406 | 224 | 55.2% | +2,712  | 17.8 |
| two_pair_plus  | 0.7-1.05       | 474 | 206 | 43.5% | -4,403  | 23.5 |
| two_pair_plus  | >=1.05         | 223 | 69  | 30.9% | -5,576  | 25.8 |
| draw           | <0.4           | 68  | 26  | 38.2% | -33     | 9.7  |
| draw           | 0.4-0.7        | 139 | 49  | 35.3% | -2,081  | 16.5 |
| draw           | 0.7-1.05       | 133 | 41  | 30.8% | -2,472  | 19.2 |
| draw           | >=1.05         | 31  | 10  | 32.3% | -489    | 19.5 |
| air            | <0.4           | 50  | 11  | 22.0% | -959    | 9.9  |
| air            | 0.4-0.7        | 88  | 17  | 19.3% | -2,126  | 15.9 |
| air            | 0.7-1.05       | 57  | 10  | 17.5% | -1,339  | 17.3 |
| air            | >=1.05         | 15  | 1   | 6.7%  | -764    | 16.4 |

Cash turn call-all-in (action `all_in` facing a bet): one_pair:top n=188, 41.5%, -3,728;
one_pair:under n=75, 17.3%, -4,016; two_pair_plus n=299, 63%, +8,692.

MTT (sample 11,560):

| hand class     | size     | n   | won | win%  | net     | avg call bb |
|----------------|----------|----:|----:|------:|--------:|------------:|
| one_pair:top   | <0.4     | 133 | 67  | 50.4% | -760    | 11.8 |
| one_pair:top   | 0.4-0.7  | 267 | 131 | 49.1% | -991    | 16.5 |
| one_pair:top   | 0.7-1.05 | 305 | 107 | 35.1% | -7,831  | 22.7 |
| one_pair:top   | >=1.05   | 83  | 19  | 22.9% | -3,525  | 28.4 |
| one_pair:under | <0.4     | 128 | 45  | 35.2% | -1,348  | 9.6  |
| one_pair:under | 0.4-0.7  | 281 | 90  | 32.0% | -3,139  | 13.1 |
| one_pair:under | 0.7-1.05 | 221 | 68  | 30.8% | -4,021  | 18.4 |
| one_pair:under | >=1.05   | 45  | 6   | 13.3% | -1,614  | 21.3 |
| two_pair_plus  | <0.4     | 123 | 72  | 58.5% | +1,141  | 11.0 |
| two_pair_plus  | 0.4-0.7  | 295 | 182 | 61.7% | +3,251  | 14.6 |
| two_pair_plus  | 0.7-1.05 | 267 | 123 | 46.1% | -2,045  | 20.6 |
| two_pair_plus  | >=1.05   | 96  | 36  | 37.5% | -1,218  | 25.8 |
| draw           | all      | 310 | 128 | 41.3% | -1,783  | 13   |
| air            | all      | 164 | 32  | 19.5% | -4,013  | 15   |

MTT turn call-all-in: one_pair:top n=443, 43.1%, -6,799; one_pair:under n=239, 25.5%,
-5,413; two_pair_plus n=523, 66.5%, +11,506.

Reading: at <0.4 pot a top-pair turn call is fine (50% won, about break-even). From 0.7 pot
up it wins 21-35% against a required ~41-50%, and the under-pair never clears the price at
any size. The horse's turn fold rate with one pair facing a bet is 3-9% (next section).

### 2.2 FLOP calls facing a c-bet, and what happens on the turn

Flop decision facing exactly one bet by the preflop aggressor (horse was not the aggressor):

| seg  | hand class     | act   | n     | won | win%  | net     | avg bet/pot | avg call bb |
|------|----------------|-------|------:|----:|------:|--------:|------------:|------------:|
| cash | one_pair:top   | call  | 1,188 | 494 | 41.6% | -13,576 | 0.58 | 6.4 |
| cash | one_pair:top   | raise | 310   | 166 | 53.5% | -1,091  | 0.54 | 4.7 |
| cash | one_pair:under | call  | 573   | 264 | 46.1% | +1,529  | 0.49 | 5.8 |
| cash | one_pair:under | raise | 131   | 37  | 28.2% | -3,707  | 0.50 | 4.5 |
| cash | draw           | call  | 416   | 224 | 53.8% | +3,496  | 0.55 | 6.1 |
| cash | air            | call  | 231   | 73  | 31.6% | -2,736  | 0.48 | 7.0 |
| cash | air            | raise | 55    | 12  | 21.8% | -1,134  | 0.47 | 4.6 |
| cash | two_pair_plus  | raise | 650   | 535 | 82.3% | +37,309 | 0.51 | 4.7 |
| MTT  | one_pair:top   | call  | 973   | 446 | 45.8% | -5,431  | 0.57 | 6.5 |
| MTT  | one_pair:top   | raise | 217   | 120 | 55.3% | +632    | 0.52 | 4.5 |
| MTT  | one_pair:under | call  | 576   | 278 | 48.3% | +489    | 0.52 | 6.1 |
| MTT  | one_pair:under | raise | 149   | 51  | 34.2% | -1,995  | 0.51 | 3.7 |
| MTT  | draw           | call  | 352   | 217 | 61.6% | +5,200  | 0.54 | 5.9 |
| MTT  | air            | call  | 224   | 81  | 36.2% | -1,977  | 0.51 | 7.5 |
| MTT  | two_pair_plus  | raise | 567   | 462 | 81.5% | +28,191 | 0.51 | 4.6 |

Flop calls not facing a plain c-bet (horse was the aggressor, or multiple raises): cash
one_pair:top call n=677, 43%, -13,183; one_pair:under call n=366, 25%, -11,654; air call
n=321, 18%, -9,775. Most of these are the "bet then raised" branch in 2.4.

After calling the flop with one pair, the horse's turn action when it faces another barrel:

| seg  | flop class     | faced turn barrel | fold | fold% | call | raise | call-all-in | net of callers |
|------|----------------|------------------:|-----:|------:|-----:|------:|------------:|---------------:|
| cash | one_pair:top   | 1,361 | 44 | 3.2% | 949 (34.6% won) | 209 | 159 | -22,788 |
| cash | one_pair:under | 710   | 67 | 9.4% | 460 (34.1% won) | 135 | 48  | -8,978  |
| MTT  | one_pair:top   | 1,032 | 29 | 2.8% | 559 (35.8% won) | 122 | 322 | -12,030 |
| MTT  | one_pair:under | 610   | 46 | 7.5% | 332 (38.6% won) | 84  | 148 | -2,806  |

And the river after flop call + turn call with one pair (still one pair on the river):

| seg  | class | faced river bet | fold | fold% | call (won) | net of callers |
|------|-------|----------------:|-----:|------:|-----------:|---------------:|
| cash | top pair  | 538 | 114 | 21.2% | 357 (34.7%) | -11,971 |
| cash | under pair| 278 | 90  | 32.4% | 136 (33.1%) | -4,665  |
| MTT  | top pair  | 301 | 50  | 16.6% | 207 (35.7%) | -5,420  |
| MTT  | under pair| 172 | 55  | 32.0% | 75 (34.7%)  | -1,544  |

The horse station-calls three streets with one pair: it folds the turn 3% of the time and
the river 17-32% of the time, and the hands that call all three streets with top pair lose
-12k (cash) / -5.4k (MTT) in the sample.

### 2.3 Preflop

Calling a 3-bet after opening (horse opened, was 3-bet; IP = horse acts after the 3-bettor):

| seg  | hole class  | pos | act   | n   | won | win%  | net    | avg to-call bb | avg pot bb |
|------|-------------|-----|-------|----:|----:|------:|-------:|---------------:|-----------:|
| cash | broadway    | ip  | call  | 343 | 151 | 44.0% | -2,423 | 7.3 | 13.8 |
| cash | broadway    | oop | call  | 265 | 133 | 50.2% | +628   | 6.2 | 14.2 |
| cash | broadway    | ip/oop | raise (4-bet) | 72 | 26 | 36.1% | -1,377 | 7.1 | 14.7 |
| cash | pocket_pair | ip  | call  | 244 | 114 | 46.7% | +381   | 7.2 | 13.7 |
| cash | pocket_pair | oop | call  | 178 | 91  | 51.1% | +2,580 | 6.2 | 14.8 |
| cash | pocket_pair | ip/oop | raise | 152 | 89 | 58.6% | +2,898 | 7.0 | 14.5 |
| MTT  | broadway    | ip  | call  | 322 | 166 | 51.6% | +953   | 7.2 | 13.9 |
| MTT  | broadway    | oop | call  | 331 | 175 | 52.9% | +744   | 6.1 | 14.4 |
| MTT  | broadway    | ip/oop | raise | 80 | 29 | 36.2% | -859   | 7.3 | 16.0 |
| MTT  | pocket_pair | oop | call  | 238 | 129 | 54.2% | +4,393 | 5.9 | 14.1 |
| MTT  | pocket_pair | ip  | call  | 194 | 108 | 55.7% | +1,517 | 7.1 | 13.7 |

Calling a 3-bet OOP is not a leak in this subset (slightly positive both segments); the
only negative preflop-vs-3-bet cells are the broadway 4-bets (small). Suited connectors
and suited aces are almost never in a 3-bet pot (n <= 6).

Cold-calling an open (not BB):

| seg  | hole class       | n   | won | win%  | net    |
|------|------------------|----:|----:|------:|-------:|
| cash | broadway, btn    | 396 | 213 | 53.8% | +1,402 |
| cash | broadway, other  | 562 | 274 | 48.8% | -759   |
| cash | broadway, sb     | 392 | 206 | 52.6% | +128   |
| cash | pocket_pair, all | 518 | 303 | 58.5% | +8,696 |
| cash | suited_ace, all  | 103 | 49  | 47.6% | -1,784 |
| MTT  | broadway, all    | 1,048 | 546 | 52.1% | +3,773 |
| MTT  | pocket_pair, all | 458 | 285 | 62.2% | +7,851 |
| MTT  | suited_ace, all  | 61  | 31  | 50.8% | +753   |

BB defence vs a single open, by open size (opens are overwhelmingly 2-2.5x here):

| seg  | hole class       | act  | open size | n     | won | win%  | net    |
|------|------------------|------|-----------|------:|----:|------:|-------:|
| cash | junk             | call | <=2.5x    | 1,181 | 599 | 50.7% | +5,388 |
| cash | junk             | call | 2.5-3.5x  | 239   | 109 | 45.6% | -312   |
| cash | broadway         | call | <=2.5x    | 356   | 162 | 45.5% | -1,730 |
| cash | broadway         | call | 2.5-3.5x  | 146   | 76  | 52.1% | +1,296 |
| cash | broadway         | 3-bet| <=2.5x    | 152   | 57  | 37.5% | -2,726 |
| cash | broadway         | 3-bet| 2.5-3.5x  | 64    | 32  | 50.0% | -346   |
| cash | pocket_pair      | call | <=2.5x    | 136   | 98  | 72.1% | +5,965 |
| cash | pocket_pair      | 3-bet| <=2.5x    | 174   | 104 | 59.8% | +2,208 |
| cash | suited_connector | call | <=2.5x    | 131   | 90  | 68.7% | +3,755 |
| cash | suited_ace       | call | <=2.5x    | 80    | 41  | 51.3% | +430   |
| MTT  | junk             | call | <=2.5x    | 1,192 | 656 | 55.0% | +7,053 |
| MTT  | broadway         | call | <=2.5x    | 285   | 165 | 57.9% | +2,205 |
| MTT  | broadway         | 3-bet| <=2.5x    | 171   | 79  | 46.2% | -1,249 |
| MTT  | pocket_pair      | 3-bet| <=2.5x    | 162   | 90  | 55.6% | -321   |
| MTT  | pocket_pair      | call | <=2.5x    | 106   | 69  | 65.1% | +1,388 |

The only BB-defence cell that loses is 3-betting broadway hands vs a min-open (cash 37.5%,
-2,726; MTT 46%, -1,249). BB calls with junk are positive, but this is the class most
inflated by the |net| >= 20bb selection (a junk defence that loses small is invisible; one
that flops two pair and stacks someone is in the table).

Where the money goes preflop, by first action (hand-level outcome, cash): opening from
EP/MP ("other") and ending in a big pot n=3,730, 43.2% won, -24,931 (-211k/wk); opening the
button n=743, 47%, -3,475; opening the SB n=350, 48%, -2,542; SB 3-bet vs open n=466, 49%,
-3,641. In MTT the same EP/MP-open class is +949 (n=3,481, 49.7%). This is not a preflop
leak as such (the open is fine); it says that in cash the horse as preflop aggressor loses
the big pots, which is classes 2 and 3 (bet, get raised, call).

### 2.4 River one-pair VALUE BETS: how often raised, and what the horse does

First river bet by the horse (no prior river aggression):

| seg  | bet class      | bets | not raised (won%)   | raised | raised% | fold | call (won) | call-all-in (won) | net when raised |
|------|----------------|-----:|---------------------|-------:|--------:|-----:|------------|-------------------|----------------:|
| cash | one_pair:top   | 901  | 753 (74.8%, +18,621)| 148    | 16.4%   | 2    | 123 (13.8%) | 23 (4.3%)        | -11,688 |
| cash | one_pair:under | 396  | 300 (36.3%, -3,656) | 96     | 24.2%   | 16   | 71 (12.7%)  | 9 (0%)           | -4,309  |
| cash | air            | 182  | 153 (22.9%, -3,755) | 29     | 15.9%   | 19   | 9 (0%)      | 1                | -925    |
| cash | two_pair_plus  | 2,204| 1,800 (86.4%, +79,266)| 404  | 18.3%   | 13   | 276 (43.8%) | 108 (64.8%)      | +1,706  |
| MTT  | one_pair:top   | 525  | 444 (76.6%, +10,681)| 81     | 15.4%   | 3    | 56 (17.9%)  | 22 (13.6%)       | -3,969  |
| MTT  | one_pair:under | 253  | 198 (40.4%, -2,858) | 55     | 21.7%   | 8    | 33 (24.2%)  | 14 (21.4%)       | -1,919  |
| MTT  | two_pair_plus  | 1,600| 1,332 (87.2%, +52,801)| 268  | 16.8%   | 3    | 171 (46.8%) | 87 (54.0%)       | +836    |

When a one-pair river bet is raised the horse folds 1.4% (top pair, cash) to 17% (under
pair) and calls or jams the rest; those calls win 12-19%. By raise size (cash): top pair
calling a raise <0.7 pot n=63, 4.8% won, -7,618 (avg to-call 57 bb); 0.7-1.5 pot n=82,
18.3%, -3,888; under pair <0.7 pot n=27, 0% won, -1,425. The small raise is the worst
cell: a min-ish raise over a river bet is almost pure value and the horse reads it as a
cheap call. (The already-measured V61/V63 shade covers river calls of a BET; this is the
committed branch after the horse's own bet.)

The same branch earlier in the hand (horse bets, is raised, calls):

| seg  | street | hand class     | call n | won | win%  | net     | all-in n (won) | fold n |
|------|--------|----------------|-------:|----:|------:|--------:|----------------|-------:|
| cash | flop   | one_pair:top   | 602 | 261 | 43.4% | -11,213 | 35 (48.6%)     | 2  |
| cash | flop   | one_pair:under | 237 | 53  | 22.4% | -9,674  | 4 (0%)         | 9  |
| cash | flop   | air            | 201 | 27  | 13.4% | -7,557  | 3              | 4  |
| cash | flop   | draw           | 142 | 59  | 41.5% | +369    | 2              | 3  |
| cash | flop   | two_pair_plus  | 139 | 69  | 49.6% | -1,861  | 20 (70%)       | 0  |
| cash | turn   | one_pair:top   | 372 | 147 | 39.5% | -10,271 | 71 (39.4%, -1,951) | 10 |
| cash | turn   | one_pair:under | 182 | 36  | 19.8% | -7,559  | 25 (16%, -1,374)   | 28 |
| cash | turn   | draw           | 64  | 13  | 20.3% | -2,218  | 4              | 23 |
| cash | turn   | two_pair_plus  | 452 | 232 | 51.3% | +1,131  | 142 (69.7%, +7,388) | 8 |
| MTT  | flop   | one_pair:top   | 441 | 182 | 41.3% | -11,335 | 75 (38.7%)     | 0  |
| MTT  | flop   | one_pair:under | 200 | 57  | 28.5% | -4,138  | 32 (37.5%)     | 6  |
| MTT  | flop   | air            | 164 | 33  | 20.1% | -4,078  | 22 (31.8%)     | 12 |
| MTT  | turn   | one_pair:top   | 237 | 104 | 43.9% | -4,925  | 131 (48.1%, -2,137) | 5 |
| MTT  | turn   | one_pair:under | 174 | 36  | 20.7% | -4,677  | 61 (23%, -1,568)    | 9 |
| MTT  | turn   | two_pair_plus  | 274 | 149 | 54.4% | +850    | 148 (64.9%, +5,039) | 4 |

The horse folds to a raise after its own bet almost never on the flop (cash 15 folds out of
1,196 one-pair/air decisions) and the raise it faces averages 0.86 pot.

### 2.5 All-in preflop by effective stack and hand strength

Tier: premium = QQ+/AK; strong = 88-JJ, AJ, AQ-AT suited, KQs; medium = 55-77, Ax suited,
A9+, two broadways; weak = rest. "shove_open" = unopened pot, "shove_over" = jam over a
raise, "call_allin" = called a jam (all_in with no full-raise flag, or a call for the stack).

Cash (n = 362 in the sample; almost all 100bb+, premium):

| stack bucket / kind    | tier     | n   | won | win%  | net    | avg stack bb |
|------------------------|----------|----:|----:|------:|-------:|-------------:|
| 30+ shove_over         | premium  | 272 | 168 | 61.8% | +753   | 227 |
| 30+ shove_over         | strong   | 27  | 14  | 51.9% | -501   | 114 |
| 30+ call_allin         | premium  | 50  | 31  | 62.0% | +2,392 | 126 |
| 30+ call_allin         | weak/med | 3   | 0   | 0%    | -728   | 243 |
| by hole: shove_over broadway (AK-type) | | 56 | 26 | 46.4% | -2,101 | 149 |
| by hole: shove_over pocket pair        | | 249| 158| 63.5% | +2,218 | 228 |

Expected equity for QQ+/AK jamming 100-200bb over a raise and getting called (by a call
range of roughly QQ+/AK) is about 50-55%; 62% realized is fine. The one soft cell is
AK-type jams (46% realized, -2,101 sampled, about -18k/wk): at 150bb effective the
calling range is pairs that AK flips against or is behind.

MTT (n = 1,147; the <=15bb bucket is 100% won because a lost <=15bb all-in never reaches
20bb and is excluded, so that bucket says nothing):

| stack / kind          | tier     | n   | won | win%  | net    |
|-----------------------|----------|----:|----:|------:|-------:|
| 15-30 shove_open      | premium  | 31  | 25  | 80.6% | +438   |
| 15-30 shove_open      | strong   | 28  | 18  | 64.3% | +197   |
| 15-30 shove_open      | medium   | 147 | 76  | 51.7% | +179   |
| 15-30 shove_open      | weak     | 90  | 43  | 47.8% | -43    |
| 15-30 shove_over      | premium  | 144 | 106 | 73.6% | +1,726 |
| 15-30 shove_over      | strong   | 89  | 58  | 65.2% | +663   |
| 15-30 shove_over      | medium   | 62  | 35  | 56.5% | +217   |
| 15-30 call_allin      | premium  | 43  | 28  | 65.1% | +408   |
| 15-30 call_allin      | strong   | 43  | 27  | 62.8% | +266   |
| 15-30 call_allin      | medium   | 30  | 15  | 50.0% | +18    |
| 15-30 call_allin      | weak     | 11  | 4   | 36.4% | -65    |
| 30+ shove_over        | premium  | 346 | 219 | 63.3% | +2,659 |
| 30+ shove_over        | strong   | 48  | 24  | 50.0% | -124   |
| 30+ call_allin        | premium  | 60  | 29  | 48.3% | -379   |
| 30+ call_allin        | strong   | 6   | 1   | 16.7% | -236   |

Realized vs expected: 15-30bb open-jams with medium/weak hands win 48-52% (these are
called by a tighter range, so 45-50% is expected when called; the uncalled wins are mostly
below 20bb and missing). Premium jams win 63-74% vs ~55-65% expected. Nothing here is a
weekly leak above ~10k bb; preflop all-in play is sound in the big-pot subset. The one
cell to watch is 30+bb calls of a jam with premium hands (48%, n=60): deeper jams are
coolers (AA/KK vs QQ/AK), as expected.

### 2.6 Multiway (3+ players saw the flop) vs heads-up, one-pair call outcomes

| seg  | street | class          | HU n (won%) | HU net / hand | MW n (won%) | MW net / hand |
|------|--------|----------------|-------------|--------------:|-------------|--------------:|
| cash | flop   | one_pair:top   | 1,042 (41.3%) | -15.3 | 822 (43.3%) | -13.1 |
| cash | flop   | one_pair:under | 620 (37.3%)   | -11.6 | 318 (38.7%) | -9.6  |
| cash | turn   | one_pair:top   | 785 (34.3%)   | -22.5 | 514 (38.1%) | -24.3 |
| cash | turn   | one_pair:under | 537 (27.4%)   | -24.3 | 278 (29.5%) | -24.0 |
| cash | river  | one_pair:top   | 458 (22.5%)   | -39.3 | 252 (30.2%) | -39.1 |
| cash | river  | one_pair:under | 285 (12.6%)   | -41.5 | 147 (17.7%) | -43.1 |
| MTT  | flop   | one_pair:top   | 895 (45.0%)   | -8.9  | 577 (43.8%) | -14.6 |
| MTT  | turn   | one_pair:top   | 491 (42.2%)   | -15.3 | 294 (39.5%) | -18.9 |
| MTT  | turn   | one_pair:under | 462 (33.5%)   | -13.4 | 211 (25.1%) | -18.6 |
| MTT  | river  | one_pair:top   | 251 (33.5%)   | -22.2 | 143 (28.0%) | -39.2 |
| MTT  | river  | one_pair:under | 161 (20.5%)   | -27.2 | 113 (25.7%) | -34.6 |

Multiway is not a separate leak in cash (per-hand loss is the same, win rates slightly
higher because multiway bets are smaller); in MTT multiway one-pair calls lose 30-75% more
per hand than heads-up on the turn and river. The multiway tightening (`mw`) in the call
line is doing roughly its job; the problem is the heads-up baseline.

---

## 3. Top 5 leaks by weekly net loss, with likely engine cause and fix shape

All fixes are in `server/src/engine/HorseLogic.ts` unless noted. Line numbers are from the
v63 worktree (`scripts/horse-measure/v63`).

### Leak 1: turn calls with one pair facing a bet of 0.7 pot or more (cash -308k/wk incl. all sizes, MTT -185k/wk; the >=0.7-pot cells alone are cash -302k, MTT -142k)

Measured: top pair wins 29% (cash) / 35% (MTT) vs a 0.7-1.05 pot bet, 23% vs an overbet,
against a required ~41-50%; under pair wins 21% / 31%. Fold rate with one pair on the turn
is 3-9%.

Likely cause: for hold'em before the river the call is still the heuristic line at
`HorseLogic.ts:10548` (`eq15 + impliedBonus >= potOdds + 0.03*respect + sizingPenalty +
posEdge + dominationPenalty`). `sizingPenalty` is capped at 0.06 (`min(0.06, betRatio*0.04)`),
so a pot-sized turn barrel costs one pair six points above pot odds and an overbet no more;
`eq15` is equity against a range read that V61 already showed is too bluff-heavy for a
bettor on the river, and the same read is used on the turn. The V38 barrel pricing
(`continuation38`, line ~10310) that charges the next street only engages with a HorseMind
`betCheckedTo` read of `n >= EXPLOIT_FAST_ENGAGE_MIN_N` on that opponent; with no read the
turn call is priced as if the river were free, and the horse then pays the river anyway
(2.2: river fold 17-32% after calling flop and turn).

Fix shape: (a) extend the V61/V63 price-scaled one-pair shade to the TURN for single-board
hold'em (gate `street === 'turn' && cat <= 2`, slope from the same `r = toCall/(pot+toCall)`,
cap ~0.12-0.15 reached at a pot-sized wager, withheld when `respect < 1`); the measured gap
between realized and required is 12-20 points at >=0.7 pot and about zero below 0.4 pot,
which is the V63 shape. (b) Make `continuation38` engage for hold'em one pair with a prior
barrel probability when there is no read (the bettor's measured river barrel rate after a
turn bet is high in this population; use the V62 polar sampler's bet frequency as the
prior), so the turn call is priced with the river bet included. (c) Keep the <0.4-pot cells
untouched (they are break-even or positive). Test on the same subset: turn one-pair calls
at >=0.7 pot should drop in count and the fold rate should rise from 3% toward 25-35%.

### Leak 2: flop bet, raised, call with one pair or air (cash -241k/wk, MTT -163k/wk)

Measured: top pair calls the raise 602 times and wins 43% (cash) / 41% (MTT); under pair
22-29%; air 13-20%. Folds: 15 of 1,196 cash decisions. Average raise 0.86 pot, 15-16 bb.

Likely cause: the committed branch (`HorseLogic.ts:9684`,
`committed = spr < 1.2 || toCall >= stack || invested/(commitmentStack+invested) >= 0.3`)
and, below it, `required = potOdds + 0.02 + dominationPenalty*0.5 + commit20 + scare21`
with the floor `eq15 >= max(required, 0.42 + mw)`. After a c-bet of 0.5-0.75 pot the
horse's own investment plus a pot-sized raise frequently pushes it over the 0.3 invested
ratio or under SPR 1.2, so a one-pair hand is judged "committed" and calls at pot odds + 2
points. One pair's `eq15` against a flop raise range (raises over a c-bet are value-heavy in
this population: the horse wins 43% with TOP pair) sits around 0.42-0.48, which clears
0.42. `raisedAfterAggr` (line 7221) only feeds the V21 raise discipline and the V23
`planCallOnly23`; it does not tighten the call bar itself.

Fix shape: (a) do not let the horse's own c-bet count toward commitment on the flop and
turn when `cat <= 2 && raisedAfterAggr`: compute `committed` from SPR after the call only
(`spr < 1` with the raise included), so a 15bb raise into a 100bb stack is a priced call,
not a committed one. (b) Add a raise-after-bet shade analogous to V61 (`shade61c` already
lives in this branch for the river): facing a raise of >=0.5 pot with one pair or no pair
on the flop/turn, add 0.08-0.12 to `required` and drop the 0.42 floor to the shaded
required. (c) Default the V23 bet plan for a one-pair c-bet with no read to "fold to a
raise >= 0.6 pot" (today the plan is call-once); with a read of an over-raiser
(`respect < 1`) keep call-once. Expected effect on the subset: raised flop c-bets with one
pair/air fold 40-60% of the time instead of 1%.

### Leak 3: turn bet, raised, call or call-all-in with one pair (cash -179k/wk, MTT -111k/wk)

Measured: top pair calls the turn raise and wins 39.5% (cash) / 44% (MTT), under pair 20-21%,
average raise 0.7-0.8 pot, 26-30 bb; the all-in version (71+25 cash, 131+61 MTT) wins
16-48%. Folds: 38 of 688 cash decisions.

Likely cause: same committed branch as leak 2, now with the turn c-bet (typically 0.6-0.75
pot, 20-30 bb) already in, so `investedNow/(stack+invested) >= 0.3` or `spr < 1.2` is
nearly always true after a raise; the branch's V51 river flat exists but there is no
turn-specific "one pair facing a raise after own bet" rule, and V57 (`v57TournamentAggression`)
only adds a tournament fold for one-card low flushes. V53 "continued pressure" (line 6531)
and V60 cash pressure raise the horse's turn barrel frequency with one pair, which is
correct, but every barrel that gets raised is then called at the committed price.

Fix shape: a turn clause in the committed branch for single-board hold'em: when
`raisedAfterAggr && cat <= 2 && toCall >= 0.5*pot` and the opponent's read is not an
over-raiser, fold unless `eq15 >= potOdds + 0.10` computed against a value-weighted raise
range (reuse the V62 sampler with the raise's polarity set to value-heavy: the measured
win rate of 40% with top pair says the raiser has it 60% of the time). Treat the horse's
turn bet plus a raise as a stack-off decision and route it through the V38 arithmetic
(`risk38` survival premium) rather than the heuristic committed floor. In MTT the call-all-in
cells (-3,705 sampled) should additionally carry the V57 survival premium, which today only
applies on the river/solverless path.

### Leak 4: river one-pair value bet raised, then call or jam (cash -129k/wk, MTT -47k/wk)

Measured: raised 16% (top pair) / 22-24% (under pair) of the time; the horse folds 1.4-17%
and its calls win 12-19%; calling a raise under 0.7 pot wins 0-5% (cash n=90, -9,043).

Likely cause: this is the committed branch at `HorseLogic.ts:9768-9801` (`shade61c`), which
is gated `!polar62`. When V62 sampled the opponent's river action as polar, the shade is
withheld on the reasoning that the polar model already carries bluffs; but V62's bluff
share was fitted to river BETS, and a RAISE over a value bet is far more value-heavy
(measured: top pair wins 14-18% of calls). The branch therefore prices a raise with a bet's
bluff share, and the 0.42 floor plus a 43-57 bb call reads as cheap when the horse already
has 40 bb in. The V64 work in progress covers the horse's own river raises; this is the
mirror case and is not covered by V61/V63 (bet-facing) either.

Fix shape: in the committed branch, when `raisedAfterAggr && isRiver && cat <= 2` (or
board-paired two pair), (a) do not withhold the shade for `polar62`; use a raise-specific
bluff share in `HorseEval` (V62_BLUFF_SHARE for raises ~ 0.10-0.15 vs the bet value) or
simply apply `V63_RIVER_SHADE_SHAPE` with a +0.08 raise offset; (b) delete the 0.42 floor
for this case and require `eq15 >= potOdds + shade`; (c) keep the call when `respect < 1`
(measured over-raiser). Expected: one-pair river bets fold to a raise 60-80% of the time;
the 753 unraised top-pair value bets (+18,621) are untouched.

### Leak 5: turn calls with air or a draw (cash -62k/wk, MTT -25k/wk)

Measured: air calls win 19-20% at any size (cash n=210, -5,188; MTT n=164, -4,013); draws
win 31-35% vs >=0.7-pot bets (cash n=164, -2,961) and are about break-even below 0.4 pot.

Likely cause: `impliedBonus` in the heuristic line plus the draw-equity realization: the
turn draw is priced with implied odds that assume the river bet gets paid, but the horse is
the one paying (leak 1) and the draw is drawing against a range that bets big with made
hands. For air, the call comes from the "disciplined bluff-catch" and `exploit.callDownMod`
paths with `eq15` inflated by the same bluff-heavy read as leak 1.

Fix shape: fold the implied bonus into the V38 barrel continuation for hold'em (price the
draw as "call now, face a river bet of the sampled size when it misses"), cap `impliedBonus`
at zero vs a bet >= 0.7 pot when the opponent stack behind is under 1.5x pot, and apply
the leak-1 turn shade to `cat === 0` hands with no draw.

Not leaks (do not spend effort): calling a 3-bet OOP (positive both segments), BB defence
by calling (positive), preflop all-ins (sound), multiway specifically (same per-hand loss
as heads-up in cash). Small negatives: BB 3-bet with broadway vs a min-open (-33k/wk
combined), AK-type 150bb jams over a raise (-18k/wk), suited-ace cold calls (-15k/wk).

---

## 4. Caveats

1. The table holds only hands with `|net_bb| >= 20`. For CALL classes this biases net
   negative: a call that wins a pot under 20bb is invisible, a call that loses 20bb+ is
   in. The bias is small where the price alone is 15bb+ (turn and river calls: the pot
   after the call is 40bb+ so wins qualify) and large on the flop (avg call 6bb), so the
   flop-call cells in 2.2 (class 6) are directional, not a measured EV. FOLD classes only
   appear when the horse had already put 20bb in, so fold rates are measured on hands
   that reached a big pot, not on all hands.
2. Preflop all-ins under ~20bb effective appear only when won (2.5), and BB junk
   defences appear only when they went big (2.3). Do not read those cells as EV.
3. Weekly figures are 12 percent samples scaled by the segment's row count; cell totals
   above ~5k sampled bb are stable to roughly +/-15 percent, cells under n=50 are not.
4. `net` is the whole hand's result for hands containing the decision, as in the brief,
   so a river loss is attributed to every earlier call in that hand; classes 1-4 were
   defined to be disjoint so the ranking does not double count.
5. Hand classes are hero-vs-board (a board flush or straight counts as two_pair_plus for
   everyone); overpair and top pair are merged as `one_pair:top`.
6. Lightning formats are inside "cash" (36 percent of cash rows); hu_cash is 2 percent.
