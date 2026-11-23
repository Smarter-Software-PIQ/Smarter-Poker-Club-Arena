# server/src/engine/AHoldemAllInCallReferenceReceiptIsValid.law.test.ts

When `holdemTournamentAllInCallIsPriced` takes ownership of a preflop fold or call from `chart_open_jam` or `variant_price`, `holdemAllInCallReference` must reset `phase6Ref.route` to the active preflop reference owner (`intent_engine` under V7, `legacy_preflop` otherwise) with `lookup = null` so `horsePhase6AttributionMismatch` never refuses the receipt as `reference_owner`.
