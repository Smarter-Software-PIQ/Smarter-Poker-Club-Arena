# tests/a-migration-cannot-force-the-installers-claim-check.law.test.ts

A migration from 20261123024924 on may not run SET CONSTRAINTS ALL IMMEDIATE on its install path: it fires the applier's own deferred claim check before the history row exists and production refuses the install (migration_applier_claim_unrecorded, 2026-11-23). The only allowed shape is IF ... THEN SET CONSTRAINTS ALL IMMEDIATE; RAISE EXCEPTION, a probe branch that cannot commit; the applier refuses the same files before it sends anything.
