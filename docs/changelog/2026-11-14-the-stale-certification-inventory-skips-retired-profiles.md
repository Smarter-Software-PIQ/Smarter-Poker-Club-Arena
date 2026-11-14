# The stale certification inventory skips retired profiles (2026-11-14)

Every Club Create Certification run since at least 09:44 UTC on Nov 14 failed its cleanup, as did the Cert Residue Sweep (run 43628368812). In each case `fn_ca_stale_certification_accounts` hit its 8-second statement timeout.

The inventory reads reserved post-deploy profiles oldest first. On each one it runs `fn_ca_certification_identity_retired`, which makes nine existence checks, until it has collected 21 profiles that are not retired. 1,223 of the 1,269 profiles older than the 162-minute floor are already retired, so every call ran the check about 1,250 times, measured at 10.96 s. Worse, 39 profiles that no cleanup step will ever retire took up the 21-row page: owners of record of retired fixture clubs, and identities with tournament history. Newer stale identities were never reached.

A profile whose status is `deleted` has already been through retirement: the cleanup door marks retained ledger actors deleted, and the backlog was deleted the same way (`20261114163238`). `20261114185038` stops listing those profiles. With the new condition, measured read-only on production: 5 candidates in 0.06 s.

Pinned by `tests/the-stale-certification-inventory-skips-retired-profiles.law.test.ts`.
