# server/src/engine/AHorseSlowplayIsPriced.law.test.ts

The dark zero-migration option horseSlowplayIsPriced replaces the unowned H4 monster slowplay mix with deterministic EV pricing in non-Omaha / non-Fixed-Limit flop and turn spots, stays 100% byte-identical when OFF or in Omaha / Fixed-Limit (including exact fastRandom state), fires priced check and bet receipts, and stays strictly in OPTION_SWITCH_REFUSED.
