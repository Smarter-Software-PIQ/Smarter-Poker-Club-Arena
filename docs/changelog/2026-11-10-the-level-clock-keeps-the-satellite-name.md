# 2026-11-10: the level clock keeps the satellite name

The 2026-11-09 fix for weekly satellite names (20261109180446, #10204) moves the copy trigger after
`tournaments_lock_level_clock`. That is DDL on `public.tournaments`, so it was declared a daily-window file (#10235), and
the 2026-11-10 window installed nothing. Six open house satellites stayed misnamed, two of them still saying "0 GTD".

The writer is fixed instead (`20261110144349`). On INSERT, `tournaments_creation_guard` and `tournaments_lock_level_clock`
restamp the same Midway weekly terms under the same condition; the copy rules run between them. The level clock's restamp
now leaves `name` and `short_description` alone, so the copy the earlier trigger settled stands. Every other term is
restamped as before. A function replacement takes no lock on `tournaments`, so it installs through the ordinary applier.
The install refuses if the installed body drifted from 20261107175806, and it renames the open misnamed satellites once.

Pinned by `tests/a-satellite-name-survives-the-weekly-terms.law.test.ts`: every restamp in the level clock must subtract
`name` and `short_description`.
