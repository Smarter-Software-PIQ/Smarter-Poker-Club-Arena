# Cash session profit waits for the hand facts (2026-11-14)

**Symptom.** "Cash Session Hand Coverage Incomplete" reached the client error inbox about 700 times over two days from 7 people (104 on 2026-11-14 from one player). The errors arrived one per settled hand.

**Cause.** `fn_my_table_session_facts` counts the sitting's hands from `hand_history`. The profit total counts `ca_hand_facts`. For the 10 hands of the 6:01 to 6:10 AM CST sitting on table b5a40a28, each fact row landed 0.30 to 0.40 s after its hand_history row. `HAND_COMPLETED` triggers the read inside that window, so the read sees one hand more than it can price. It refuses to show a partial total, which is correct, and it reported the refusal as an error. All 10 hands had their facts afterwards.

**Fix.** `useServerCashSessionProfit` now retries that one refusal up to twice, one second apart, before reporting it. The retries are bounded and the hook never polls. Every other refusal (invalid evidence, a changed sitting) is reported immediately, and a partial total is still never shown.

Regressions in `tests/unit/serverCashSessionProfit.test.tsx`: "waits for the hand facts that land just after hand_history before reporting coverage" (fails without the fix) and "still reports a hand whose facts never arrive, after the bounded wait, and shows no partial total" (a genuine gap is reported once, after three reads, and no total is shown).
