# A Lightning switch-off starts a fresh VPIP sample

While a Lightning pool runs, nothing judges VPIP: a parked anchor runs the
sit-out clock alone. When the game left Lightning, its anchor tables became
ordinary tables and their first eviction pass ran `fn_nit_enforce`, whose sample
(`fn_nit_sitting_since`) reached back to the start of the sitting in the game.
Every pool hand is a `ca_hand_facts` row of the game, so the whole pool sitting
was judged at the switch-off with the game's ten-hand, no-grace rule: an
immediate eviction and the two-hour bar, with no warning.

Production, 30 days to 2026-11-21: 236 `vpip_evicted` bars on Lightning-format
game tables; the player's last pool session had ended `lightning_off` (160, 157
of them within 30 s of the switch-off), `lightning_drained` (42, the 2026-10-25
operator drain) or `anchor_seat_left` followed by a rejoin after the switch-off
(21). 235 were Horses. Example: game 705270cd left Lightning at 08:47:56 UTC on
2026-11-21 and two Horses with 200 and 713 sampled hands, every one a Lightning
hand (20.5% and 21.9%), were barred four to five seconds later.

`fn_nit_sitting_since` (migration `20261121152102`) now never reaches back
before the instant the game last left Lightning (the newest committed
conversion out of Lightning, or now() while one is pending), exactly as it
already never reaches back before the floor came on. Ordinary hands after the
switch-off are judged under the table's own rule, warning and grace included; a
later joiner, a never-Lightning game and every Classic floor are unchanged. 220
of the 236 bars had fewer than the game's ten hands after the switch-off and
could not have been judged at that instant. People and Horses alike. A live
pool judge is a separate, later change.

Proof by execution: `scripts/ci/test-lightning-switch-off-vpip-sample.sh`
(runs in the Classic VPIP floor proof workflow). Law:
`tests/a-lightning-switch-off-starts-a-fresh-vpip-sample.law.test.ts`.
