# tests/an-older-merged-migration-installs-first.law.test.ts

Merged ordinary migrations released by the same hold install in version order: each dispatcher waits, bounded, while an applier run for an older version is still queued or installing before it sends a newer one, and a refused older file never holds a later one hostage (incident 90972d77, 20261121024624 installed before 20261121005533 on 2026-11-21).
