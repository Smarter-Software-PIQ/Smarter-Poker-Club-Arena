/**
 * HU-FL-001 (heads-up variants audit, 2026-11-13).
 *
 * Jam-or-fold is a no-limit structure and the Omaha tournament commitment
 * zone is pot-limit arithmetic (what one pot raise costs). A fixed-limit
 * raise is one bet whatever the stack, so neither exists in a fixed-limit
 * game. The preflop gates that route a short stack into them (legacyPushFold,
 * legacyOrangeJam, the commitment zone, pushFoldOmaha) had no fixed-limit
 * exclusion: heads-up at 10 big blinds the fixed-limit hold'em small blind
 * folded 88 percent and the big blind folded 87 to 91 percent to ONE small
 * bet at 3 to 1, and a script that never looked at its cards won 0.24 to 0.37
 * big blinds per hand. The controller only ever executed those jams as
 * one-bet raises, so no rule of the game was broken; the hands were chosen by
 * the wrong chart.
 *
 * One pure answer, so the historical layer-isolation corpus
 * (HorseOpponentExploitNeutrality.law.test.ts) can hold its October 16
 * baseline without a production opt-out.
 */
export function fixedLimitHasNoJamOrFold(isFixedLimit: boolean | undefined): boolean {
  return isFixedLimit === true;
}
