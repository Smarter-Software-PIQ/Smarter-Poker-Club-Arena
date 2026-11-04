# Preflop statistics use actual decisions

The daily horse accumulator inferred 3-bet opportunities from the final hand raise count, including players who folded before an open. It also omitted voluntary all-in calls from VPIP. Hand facts treated uncalled-bet returns as decisions, producing phantom opportunities for the refunded opener.

Both producers now exclude accounting and forced events, distinguish all-in calls from raises, and use captured legal action rights when available. The daily accumulator records opportunities at the actual decision, including successful 3-bets. Settlement preserves origin, dead-contribution and public-node metadata. Historical hands without captured rights retain an action-based opportunity estimate; existing stored rollups are not retroactively corrected by this source change.

Regression coverage exercises refunds, early folds, forced contributions, short raises, call-only all-ins, cold 3-bets, limpers and the settlement-to-rollup path. Existing hand-fact derivations and positional opening/defense suites were also exercised. Deployment and new-hand production verification remain separate acceptance gates.
