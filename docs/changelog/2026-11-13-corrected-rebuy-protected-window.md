# Corrected rebuy protected database window

After original run43336881677 rolled back and thawed, the owner explicitly authorized one additional protected window for corrected migration151009 in PR #10666. The additional attempt remains unused. This booking changes no SQL, price or award and preserves all consumed orders and original receipts.

The owner subsequently answered "Authorize rescheduling the same unused attempt" to the explicit November13 00:50-02:00Chicago rescheduling question. Authorized bounds: notice06:15UTC November13; admission06:50UTC through fixed08:00UTC (00:50-02:00Chicago November13). Both protected engine orders remain byte-exact and their last notice expires06:00UTC. Actual notice lead, rolling-hour spacing, no active owner, source/engine locks,120s last-hand lead, drain/freeze,285s reserve, short SQL budgets, one attempt and originalv3thaw remain mandatory. No engine replacement, payment, automatic retry or automatic extension.

Required browser CI failed twice on the same upstream600px spectator case. The independently owned protected repair #10685 is reused unchanged; no avatar code is added by this task. Earlier unmerged timing drafts could not safely merge and were not deployed. The later fixed expiry is bound to that explicit answer; it does not authorize another attempt or an automatic extension.

Installation and affected live behavior remain separate acceptance gates.
