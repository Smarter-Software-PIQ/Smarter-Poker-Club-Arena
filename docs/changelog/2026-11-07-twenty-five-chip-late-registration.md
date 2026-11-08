# 25-chip entries use ten late-registration levels

Owner instruction: change twelve late-registration levels to ten for chip tournaments with a total buy-in of at least25 chips; keep every other setting the same. The entry total includes its existing fee (25 is stored as22.5 plus2.5).

The maintained weekly definitions and their original database catalog change only the registration field and matching description. The existing final tournament boundary applies the same rule to future writes. Installation updates nonterminal chip events and eligible schedules atomically, with whole-row comparisons that refuse changes to unrelated fields. Terminal history, other currencies, other registration caps, rebuy/add-on settings, prices, clock and blind structures, guarantees and schedules are preserved. Existing add-on admission semantics remain intact.

The bounty normalizer preserves its separately authored rebuy cap during a cutoff-only change and later writes. No new trigger, scheduler, engine replacement or client release is required. The existing required native Midway creation harness verifies exact25, below25, running/terminal, other currencies, future inserts, repeated writes and whole persisted records.

Deployment uses the exact migration from protected main through Apply Merged Migration; source and local checks alone do not establish live installation.
