# 2026-11-09: the satellite name follows the level clock terms

**Found by the A3 observation** (the first weekly satellite spawn after the 03:12Z fix). At 18:00:12Z schedule d84a104f
created `7eae51cb` with the right target (`80e0c952`, "40 Chip Freezeout - 1.5K GTD (NLH)", 2026-11-12 18:00Z) and no
duplicate, but named "40 Chip Freezeout - 0 GTD (NLH) Satellite 5". `e0c83025` (17:15Z, "Sunday Deep Stack Satellite 25")
had the same defect.

**Cause.** `tournaments_lock_level_clock` restamps Midway weekly rows on INSERT with
`NEW := jsonb_populate_record(NEW, fn_ca_midway_weekly_terms(NEW.schedule_id))`, name and short description included, and
it sorts after `tournaments_d_copy_follows_the_weekly_terms`. The 20261109023856 fix only ordered itself after
`tournaments_creation_guard`, the other trigger that does the same thing. The copy rules themselves were right: run on the
stored row they return "Satellite Into 40 Chip Freezeout (NLH)".

**Fix** (`20261109180446`). The INSERT copy trigger is now `tournaments_lz_copy_follows_the_level_clock`, directly after the
level clock and after every trigger that rebuilds NEW or writes its name; the old one is dropped. The install refuses if
any such trigger still sorts after it. The open misnamed satellites are renamed once through the admitted name edit.

**Pinned.** `tests/a-satellite-name-survives-the-weekly-terms.law.test.ts` no longer names the rewriters: it finds every
BEFORE INSERT trigger on tournaments whose latest function rebuilds NEW or writes the name, and fails the build if one sorts
after the copy trigger. With the copy trigger at its old position it fails on `tournaments_lock_level_clock`.
