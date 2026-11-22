# Certification cleanup removes a retired-club row through the gate (2026-11-20)

The operator-run Cert Residue Sweep on 2026-11-20 at 21:28 UTC (15:28 Central) retired Cert RH 58794518
and recovered 11 stale certification identities, but left 7 of 26 unrecovered.
Six of those refused with `55000 CLUB_RETIRED: gameplay and cashier records are read-only`.

## Cause

`cleanup_reserved_certification_account` has two removal branches. The
retained-ledger-actor branch already removes a zero-balance `player` row of a
**retired** club through the narrowly opened `app.club_retirement_maintenance`
gate. The final full-removal branch, which an identity with no chip-ledger
history reaches, ran a bare `DELETE FROM public.club_members WHERE user_id = p_user_id`.
Post-deploy test identities joined Cert RH / Cert HU clubs as players. Those
clubs were later retired, so the guard refused the delete and rolled back the
entire removal, on every sweep.

## Fix

Migration `20261120213250` replaces only that one line. Zero-balance player rows
of retired clubs are removed first, through the same gate, which is opened for
that one statement and closed again afterwards, including on error. The plain
delete that follows then meets only rows of live clubs. A retired-club row that
still holds chips does not match the gated delete and is still refused.

Rolled-back probe against identity 00205f11 (one DO block ending in RAISE):
the live door refused with CLUB_RETIRED; a pg_temp copy of the patched door
returned success, removed the identity, archived its 1 audit row, and left the
gate closed.

Pinned by `tests/unit/certificationCleanupRetiredClubRow.test.ts`.
