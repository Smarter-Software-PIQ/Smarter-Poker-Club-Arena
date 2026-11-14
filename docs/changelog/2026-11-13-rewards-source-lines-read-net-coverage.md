# Rewards: the "Where It Comes From" lines read net coverage (2026-11-13)

On the Nightly 20K (`27268410`) the Rewards tab printed a dash beside "195
Buy-Ins", "105 Rebuys" and "93 Add-Ons". The lines are priced net of the fee
and were checked against `fn_ca_tournament_prize_funding.collected`, which on a
finalized guaranteed event is the pool including the house's share (20,000).
The lines sum to 12,705, which is `net_coverage`, the figure the guarantee bar
already shows. They now reconcile against `net_coverage` when the read has it.

The lines also keep their cents: a 31.50 net entry printed as "x 32" and the
three rounded totals summed to 12,706.

Client only. Test: `tests/unit/theTotalPrizePoolIsEverythingPutIn.test.tsx`.
