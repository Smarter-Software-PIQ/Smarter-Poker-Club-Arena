# 2026-11-18: the exact opponent profile keeps how a re-raiser answers a raise of his own re-raise (measurement)

Measurement only. No decision reads it unless the default-OFF option `omahaReraisedCallVsRaisePriced` is on.

The profile kept how often a player re-raises and how an opener answers a re-raise. It kept nothing about a re-raiser
whose own re-raise is raised again: the number a priced 4-bet or 5-bet needs (WooWoo 48-hour audit, CALL-VS-RAISE).

- `HorseOmahaReraiseResponse.ts`: two nodes, `threeBetFacesFourBet` and `fourBetFacesFiveBet`, each
  `{opp, fold, call, raise}`. One opportunity per player per node per hand, counted only when the raise he faces is the
  very next raise after his own. Admission, the definition of a raise and the ageing are those of the existing
  opportunity-gated preflop counters (`learnablePublicAction`; half-life 30, a node ages only on a hand that gave it an
  opportunity). Public actions only.
- Storage: a new nullable column `horse_exact_profiles.reraise_response` (jsonb) beside `counters`, `long_counters`,
  `shown_river` and `street_counters`, so the 27-field wire shapes keep their bytes. Migration
  `20261118023000_exact_profile_keeps_reraiser_answers.sql` (@install-window:
  daily-maintenance; NOT installed by this change): the column, the SQL twins `fn_horse_reraise_response_increments` /
  `fn_horse_reraise_response_add`, and `fn_horse_exact_accept_hand` patched by exact fragments. Forward only, no
  back-fill. The engine reads a null, absent or malformed record as absent, so the engine may ship before the column
  exists.
- Transport: the pooled exact row carries it (`HorseOpponentMemory`, `pooledPublicProfiles`,
  `HorsePooledPublicBootstrap`), the observer reads bring a detached copy into an Omaha decision's own state
  (`HorseMindSandbox.pooledReraiseResponse`), and read frame v19 (`reraiseResponse`) journals it, so a second look and an
  exact replay carry what the first look carried. A frame without a record keeps its exact v1-v18 bytes.
- `HorseMind.omahaReraiseResponseOf(userId)` answers the record for the decision in flight.

Proof: `HorseOmahaReraiseResponse.test.ts`; `aReraiseResponseThroughTheWorker.test.ts` (FAST, DEEP, exact replay; column
full, null and absent; malformed dropped; decision bytes identical with the option off); engine / SQL parity in
`scripts/ci/test-horse-exact-public-memory.py` on `scripts/ci/fixtures/horse-reraise-response-vectors.json` (8 named hands,
240 random logs, a 120-hand chain, learning through the accepted-hand receipt, both install orders).
