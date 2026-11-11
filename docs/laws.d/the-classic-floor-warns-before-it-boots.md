# tests/the-classic-floor-warns-before-it-boots.law.test.ts

Dan's 2026-11-10 ruling put a VPIP floor on Classic cash games at 0.50/1.00 and
above, judged over a rolling thirty dealt hands with a thirty-hand minimum, for
humans and horses alike, with a warning and a grace counted in dealt hands
before the seat is cashed out. The law pins that the floors stay config rows
(so a value never needs a deploy), that every supported Classic variant carries
a row rather than an invented exemption, that fn_nit_check, fn_nit_status,
fn_cash_vpip_status and fn_nit_enforce all judge the ONE shared sample so a
player is never shown one number and booted on another, that a first lapse
warns and costs no seat while a spent grace boots exactly once (the partial
unique index and the closing UPDATE's row count being the race guards), that
vpip_rolling and vpip_grace_hands are written only inside the Classic branch so
Action and Madness keep their ten-hand window and boot on the spot as before,
that an existing stronger floor is never lowered and no hand played before the
floor existed is judged, that the DROP fn_nit_status needs puts its grants
back, that the rule reads no horse identity (CLAUDE.md 10.5) and adds no cron,
sweep or repair path (CLAUDE.md 10.12), and that the dealing loop still stands a
seat up only at a hand boundary through the single atomicCashout on
leaveMode 'vpip_evicted'. The behavioural proof runs against a real Postgres in
scripts/ci/test-classic-vpip-floor.sh.
