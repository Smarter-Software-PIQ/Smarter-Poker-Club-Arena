# The Horse Mood Hour Is Pinned For The Test Suite

Horses carry an hourly mood (`moodOf` in `server/src/engine/HorseLogic.ts`): a hash of the horse and the current hour that loosens or tightens its play for that hour. Read from the wall clock, it made every suite that measures horse frequencies depend on the hour CI happened to run in. On 2026-11-05 `HorseDefenceByOpener.test.ts` passed at 11:00 UTC and failed from 12:00 UTC on the same commit, failing every engine release for the rest of the morning (#9529 pinned that one file).

The whole server suite now runs every horse decision in one fixed mood hour: `server/src/testing/theHorseMoodHourIsPinned.ts` is a vitest setup file that sets a global the mood clock reads. Production never sets it, so live horses keep their real hourly mood, and a decision or test that passes an explicit time still measures that time. Law: `theHorseMoodHourIsPinned.law.test.ts`. All 242 test files that use HorseLogic pass under the pin.
