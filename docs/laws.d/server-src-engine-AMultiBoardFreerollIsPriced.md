# server/src/engine/AMultiBoardFreerollIsPriced.law.test.ts

The dark zero-migration option multiBoardFreerollIsPriced replaces the unowned V36 multi-board freeroll bet and raise coin flips with deterministic zero-RNG EV pricing, stays 100% byte-identical when OFF or on single-board hands (including exact fastRandom state), never folds a qualifying freeroll, strictly respects Pot-Limit caps, satisfies monotonicity in fold rate, unlocked equity, wetness/free-card risk, and heroBubbleFactor, fires priced receipts, and stays strictly in OPTION_SWITCH_REFUSED.
