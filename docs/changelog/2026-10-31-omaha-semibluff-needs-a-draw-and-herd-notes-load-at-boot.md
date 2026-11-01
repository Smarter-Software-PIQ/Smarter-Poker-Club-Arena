# Omaha semi-bluff raises need a draw; the herd's saved notes load at boot

These are follow-ups to the 2026-10-30 daily horse audit. Three defects were
read from production rows and reproduced through the real decision path.

## Top pair with no redraw re-raised as a "semi-bluff" (V74)

(Numbered V74: V70 is the GTO opening ranges, V71 the ante-aware push/fold, V72 the defence by opener and V73 the 3-bet answer, #9088.)

`plo_toppair_no_redraw_stackoff` measured -62.13 bb per hand across both
outcomes over 234 hands (seven days to 2026-10-30). The live public states of
reviews 2944297 and 2838834 were replayed through `HorseLogic.decide`:

- 2944297: PLO4, Jc 6s Ac Ks on Jh 3c 4d 8h, raised a turn bet to pot.
- 2838834: PLO5, top jack and a gutshot, raised a flop donk bet to pot in a
  3-bet pot.

Both raises fire `v53_pressure_semibluff_raise`. The branch is "semi-bluff
raise with big draws", but its only Omaha draw test was `omahaDrawMod()`. That
returned 0.7 for a hand with no draw at all. V53 pressure widens the equity
band and multiplies the frequency, so top pair with nothing to come re-raised
bets. The rate stepped up on 2026-10-28, when the presumed-aggressive Omaha
prior began firing 12-17M times a day. V53 semi-bluff raises went from 190 to
2,700 a day.

`v74OmahaSemiBluffNeedsDraw` (default on; explicit `false` is the league's off
arm) requires one of these for an Omaha semi-bluff raise:

- a flush draw;
- eight or more straight outs;
- in hi-lo, a nut low draw.

This is the redraw definition the detector already uses. Both replayed hands
now fold or call. The plo4/plo5 v74 matchups keep measuring it.

Local paired-deal league, 3,000 pairs per arm, seed 2026103102, horse against
horse:

- PLO4: -1.05 +/- 1.12 bb/100 (98 divergent pairs);
- PLO5: -0.09 +/- 1.25 bb/100 (79 divergent pairs);
- zero illegal actions.

Neither result is significant. Self-play cannot price the live population,
where the situation measured -62 bb per hand. The gate ships as a defect fix:
the branch was written for draws, and a hand with no draw is not one. The
nightly matchups pool it. A pooled-significant negative result makes
`league_layer_negative_pooled` say so, and the off arm is one flag away.

## The herd's saved opponent notes never loaded

From 2026-10-28 to 2026-10-31 every worker boot reported
`horse_pooled_public_bootstrap_unavailable`, and none reported `_loaded`.
The saved public profiles (29,816 rows, 70 MB) were read in 30 serial offset
pages under a 5 s budget. The database answers a deep page in 76 ms, but
moving about 1 MB per page from the engine host could not fit. Offset pages
also shift when a profile row is inserted mid-read, and the resulting
duplicate key discarded the whole read. The table was also 2,952 rows from the
32,768 cap.

So workers started blind, and the "until public play disproves it" Omaha
prior stayed presumed for about 85% of reads.

The bootstrap now:

- pages by keyset over complete players (at most 54 rows each, 1,000 per
  page), so it never skips or repeats a row;
- reads only rows with an observed hand;
- runs under a 30 s budget, beside the other boot loads (worker boot measured
  about 35 s);
- keeps the most-observed profiles past the cache capacity instead of
  loading nothing.

## The leak-spike baseline ignored the variant mix

A tag's rate differs by variant, and the baseline was one pooled rate.
On 2026-10-30 `big_bet_fold` read 1.51x while cash NLH, cash PLO and
Lightning were each flat. Migration `20261031225911` weights each variant's
baseline rate by the day's variant hands. Measured on 2026-10-30:

- `big_bet_fold`: 1.51x to 1.34x;
- `plo_toppair_no_redraw_stackoff`: 2.65x to 2.05x, still reported;
- `plo_set_stackoff`: 2.17x to 1.67x, still reported.

The PLO fold rise from 10-25 to 10-28 is real within format. `bet_fold_line`
rose from 22 to 59 per 1,000, while NLH stayed flat.

## The audit names a tournament start collapse, and stops expecting a retired store

`fn_audit_tournament_results` now raises `tournament_starts_collapsed` when the
day's starts fall below half the seven-day median. The finding carries the
cancellations and the current `ca_tournament_start_hold` row (migration
`20261031230756`). Read-only results:

- 2026-10-30: 79 against 10,507, named.
- 10-28, 10-29 and 10-31: quiet.

`horse_mind_stats_scoped` no longer carries a daily freshness expectation in
the data ledger. Since 2026-10-26 nothing feeds the process-wide scoped
overlay, and the herd's persistent per-context reads live in
`horse_exploit_profiles`, which keeps its own one-day freshness check. Before
this change, the audit reported the retirement as a critical `data_stale`
outage every night.
