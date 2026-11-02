# Engine hand-bound BB denomination

The engine owns the blinds dealt for each hand. Tournament level updates must not change the denomination of that hand, including broadcasts, observer views, reconnects and recovered controllers. The existing frozen controller snapshot supplies all three active publication paths.

A rejected hand identity previously omitted hand_blinds, which the compatible client interprets as an older engine and replaces with live table metadata. The modern engine now explicitly publishes null when the active hand identity or stakes cannot be validated. Between hands, legacy metadata remains permitted. This changes presentation only, not bets, blinds charged, or chip settlement.

Regression coverage exercises real engine level refresh, live/resync/observer serialization, next-hand rollover, persisted controller recovery, identity mismatch and invalid denominations. Before repair the extended engine test had5 failures and34 passes; after repair42 engine tests and11 client tests pass. Required protected checks, certified deployment and live evidence are tracked in CHECKPOINT-mongo-bb.md.
