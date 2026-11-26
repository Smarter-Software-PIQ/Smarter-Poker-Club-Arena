# tests/a-lost-option-receipt-is-visible.law.test.ts

A failed per-hand Horse option receipt write (server/src/services/HorseHandReceipts.ts) is counted in a process-lifetime tally and never throws, raises HorseHandReceiptsNotWritten once through raiseEngineAlert (the existing Production Alerts path) and resolves it on the next successful write, is published on the engine's public /health payload as `horseHandReceipts`, and its failure text is a closed word plus at most a database error code, so it can never carry a card, a user id or a token.
