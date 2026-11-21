/**
 * The public cell a run-it-twice answer is measured in (option horseRunItTwiceIsPriced):
 * who answers (chooser / responder) and how much variance a multi-run removes.
 * Shared by the engine read (HorseRunItTwicePriced.ts) and the offline compiler.
 */
export type RunItTwiceRole = 'chooser' | 'responder';

/** Variance a multi-run removes, normalised to 1 at the fair share for n players all in. */
export function runItTwiceVarianceShare(equity: number, playersAllIn: number): number {
  const n = Math.max(2, Math.floor(Number(playersAllIn) || 2));
  const f = 1 / n;
  const e = Math.min(1, Math.max(0, equity));
  return Math.min(1, (e * (1 - e)) / (f * (1 - f)));
}
