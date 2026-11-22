# omahaCbetRaiseIsPriced constants (CBET-DEFENCE 2026-11-21; criteria CRITERIA-CBET-DEFENCE.md sha256 cfb19103...)

Source: public PLO4/PLO5 cash hands that saw a flop, Nov 1-16 2026 UTC (434,098 hands; public actions only; every opponent together, no identity). The first player facing the preflop raiser's first flop bet; share that raised. Wilson 95% intervals.
| players | c-bet size | n | raises | share [95%] |
|---|---|---|---|---|
| hu | small (<0.4 pot) | 85,024 | 15,925 | 0.1873 [0.1847, 0.1899] |
| hu | half (<0.6) | 82,685 | 14,433 | 0.1746 [0.1720, 0.1772] |
| hu | two-thirds (<0.85) | 63,448 | 7,055 | 0.1112 [0.1088, 0.1137] |
| hu | pot | 31,559 | 3,275 | 0.1038 [0.1005, 0.1072] |
| mw | small | 23,672 | 908 | 0.0384 [0.0360, 0.0409] |
| mw | half | 31,569 | 1,065 | 0.0337 [0.0318, 0.0358] |
| mw | two-thirds | 15,226 | 535 | 0.0351 [0.0323, 0.0382] |
| mw | pot | 5,273 | 119 | 0.0226 [0.0189, 0.0269] |
K (prior weight): method-of-moments beta-binomial on 629 opponents with >= 20 heads-up opportunities = 786; clamped to the declared [5, 200] -> 200 (the population is nearly uniform, so the moment estimate is large).
W (range width) = 1.65 [1.60, 1.71]: ML fit of top(min(1, W rho)) on measured raising hands by flop made-hand percentile (bench, offline, aggregates; PLO4 1.75, PLO5 1.57).
Era note: daily heads-up share 0.13-0.17 Nov 1-15, 0.098 on Nov 16 (a serving change); Nov 18-20 check reported in CBET-DEFENCE.md.
