# Rebuy invariant keeps compatible triggers

The first protected installation of the rebuy/add-on invariant rolled back with a one-second lock timeout. The three trigger drops requested ACCESS EXCLUSIVE on tournaments, conflicting with a read-only pg_cron maintenance participant despite the confirmed freeze. Original run43336881677 thawed all107 tables; no migration or chip change committed.

Remove the unnecessary drops from the still-uninstalled migration. Compatible earlier normalizers remain enabled, and the final invariant trigger still enforces registered transitions and observes all earlier producer changes. CREATE TRIGGER requires only SHARE ROW EXCLUSIVE, which permits those readers. An unexpected existing final trigger refuses instead of being dropped or replayed. No timeout, freeze, cron or active-query safeguard changes.

The existing native section15 now installs the actual successor while a second connection retains AccessShareLock, then runs the same behavior contract with both original triggers present. Prior behavioral and financial evidence remains applicable to unchanged function bytes. Protected qualification and a separately eligible installation remain required; the consumed single-use operation is never retried automatically.
