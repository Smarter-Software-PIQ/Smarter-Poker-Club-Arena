/**
 * THE HORSE MOOD HOUR IS PINNED FOR THE WHOLE SUITE (2026-11-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Horses carry an hourly mood (HorseLogic.ts moodOf): a hash of the horse and
 * the current hour that loosens or tightens its play for that hour. Read from
 * the wall clock, it made every suite that measures horse frequencies depend
 * on the hour CI happened to run in. HorseDefenceByOpener.test.ts passed at
 * 11:00 UTC on 2026-11-05 and failed from 12:00 UTC on the same commit, and
 * that one test failed every engine release for the rest of the morning.
 *
 * So the suite runs every horse decision in one fixed hour. Production never
 * sets this global; a test that passes decisionTimeMs, or calls moodOf with
 * an explicit time, still measures exactly the hour it names. The constant
 * is written out here (not imported) so this setup file never loads the horse
 * engine into suites that do not use it; the law test keeps the two in step.
 */
export const PINNED_HORSE_MOOD_CLOCK_MS = Date.UTC(2026, 10, 5, 11, 0, 0);
(globalThis as Record<string, unknown>).__smarterPokerHorseMoodClockMs = PINNED_HORSE_MOOD_CLOCK_MS;
