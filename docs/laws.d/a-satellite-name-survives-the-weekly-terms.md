# tests/a-satellite-name-survives-the-weekly-terms.law.test.ts

Dan 2026-11-08: a satellite is named "Satellite Into <target>" and no event says "0 GTD". Midway weekly rows are restamped on INSERT with their catalog terms, name included, by more than one BEFORE trigger (tournaments_creation_guard, tournaments_lock_level_clock); the law reads every BEFORE INSERT trigger on tournaments from the migrations and requires the INSERT copy trigger to sort after each one that rebuilds NEW or writes its name.
