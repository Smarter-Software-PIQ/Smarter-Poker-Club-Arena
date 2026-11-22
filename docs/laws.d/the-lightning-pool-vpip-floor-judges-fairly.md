# tests/the-lightning-pool-vpip-floor-judges-fairly.law.test.ts

The Lightning Pool VPIP Floor Judge enforces the 25% VPIP floor (read from the
host table's maintain_percent_min) over a 30-hand rolling window with 10 grace
hands identically for human players and Horses seated in a Lightning pool. It
counts only committed settled hands with a voluntary preflop action opportunity
(excluding walks and forced-only blinds), warns before removing, evicts cleanly
between hands through each participant's anchor seat atomicCashout door on
leaveMode 'vpip_evicted' (guarded by isMaintenanceFrozen, inLiveLightningHand,
and LIGHTNING_HAND_IN_PROGRESS), reads no horse identity (CLAUDE.md 10.5), adds
no cron/watcher/repair path (CLAUDE.md 10.12), keeps src/lightning/ free of
direct seat or wallet writes, and resets samples cleanly on leave/rejoin and
Lightning pool switch-off/restart.
