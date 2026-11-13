/**
 * Minimal hook for the solved-flop library (HV31 FLOP-3 item B4). DORMANT.
 *
 * `solvedFlopAdviceOr(input, existing)` returns the library answer when the lookup answers
 * (flag on, library loaded, same-structure board within distance) and otherwise calls
 * `existing()` and returns its result unchanged. With the flag off (the default) or no
 * library data (the production state), `existing()` is always the answer, so wrapping a
 * call site with this hook cannot change behaviour. No call site is wired by this change.
 */
import { solvedFlopLookup, type SolvedFlopAnswer, type SolvedFlopNode } from './SolvedFlopLibrary.js';

export interface SolvedFlopAdvice extends SolvedFlopAnswer {
  source: 'solved_flop_library';
}

export function solvedFlopAdviceOr<T>(
  input: { tableType: string; flop: string; node: SolvedFlopNode; hole: readonly [string, string]; env?: NodeJS.ProcessEnv },
  existing: () => T,
): SolvedFlopAdvice | T {
  const ans = solvedFlopLookup(input);
  if (!ans) return existing();
  return { ...ans, source: 'solved_flop_library' };
}
