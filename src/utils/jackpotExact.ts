/**
 * THE BAD BEAT JACKPOT IS PRINTED TO THE CENT (Dan, 2026-11-09, binding).
 *
 * Dan, verbatim: "for the bbj display the full amount down to the decimal and
 * the exact amounts for the payouts... no rounded numbers. use exact numbers
 * 100% of the time."
 *
 * The jackpot popup printed a 5,022.37 payout as "5K" and the 2,511.18 the
 * bad beat hand received as "+2.5K", and its header truncated a 15,379.83 pool
 * to "15,379". Every one of those figures is stored to the cent
 * (bbj_pools.main_balance, bbj_payouts.total_amount and
 * bbj_payout_recipients.amount are numeric(…,2)); only the display dropped it.
 *
 * So on every Bad Beat Jackpot surface a chip amount is the stored amount:
 * thousands separators, always two decimals, never a K/M suffix, never
 * Math.round / Math.trunc / Math.floor. This later, narrower instruction takes
 * the jackpot out of the 2026-09-09 forward-facing compact rule
 * (`compactChips`), which still governs the surfaces it was written for.
 *
 * Diamonds are whole by custody (an integer column), so a Diamond jackpot is
 * already exact and keeps its own readout.
 *
 * Pinned by tests/the-jackpot-is-printed-to-the-cent.law.test.ts.
 */

/** Stored chip amount, to the cent: 15379.83 -> "15,379.83", 700 -> "700.00". */
export const jackpotChips = (n: number | string | null | undefined): string => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/** Whole cents of a stored two-decimal amount, without binary float drift. */
const toCents = (n: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(Number(`${v}e2`));
};

/** Half away from zero, the way Postgres ROUND(numeric, 2) rounds. */
const divRoundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((numerator + denominator / 2) / denominator);

/**
 * What a tier pays out of the pool right now, by the payout's own arithmetic:
 * `bbj_atomic_payout_v2` computes ROUND(main * pct / 100, 2). Percentages are
 * numeric(5,2), so they are carried as hundredths and the division is done on
 * integers.
 */
export const jackpotTotalAtPercent = (pool: number, percent: number): number => {
  const poolCents = toCents(pool);
  const pctHundredths = Math.round(Number(percent) * 100);
  if (poolCents <= 0 || !Number.isFinite(pctHundredths) || pctHundredths <= 0) return 0;
  return divRoundHalfUp(poolCents * pctHundredths, 10_000) / 100;
};

export interface JackpotSplit {
  loser: number;
  winner: number;
  table: number;
}

/**
 * The three shares of a jackpot total, to the cent, as the payout computes
 * them: the bad beat hand ROUND(total * loser, 2), the hand that won
 * ROUND(total * winner, 2), and the table takes what is left, so the three
 * always add back to the total. (At payment the table share is divided evenly
 * between the other players dealt in and any odd cent moves to the bad beat
 * hand, which depends on how many were dealt in.)
 */
export const jackpotSplit = (
  total: number,
  split: { loser: number; winner: number }
): JackpotSplit => {
  const totalCents = toCents(total);
  if (totalCents <= 0) return { loser: 0, winner: 0, table: 0 };
  const loserBp = Math.round(split.loser * 10_000);
  const winnerBp = Math.round(split.winner * 10_000);
  const loser = divRoundHalfUp(totalCents * loserBp, 10_000);
  const winner = divRoundHalfUp(totalCents * winnerBp, 10_000);
  return { loser: loser / 100, winner: winner / 100, table: (totalCents - loser - winner) / 100 };
};

/**
 * A jackpot percentage as it is, to two places with trailing zeros dropped:
 * 10 -> "10", 12.5 -> "12.5", 15.3798 -> "15.38". Replaces Math.round, which
 * printed a 12.5% policy as "13%" and a pool at 15.38% of its pivot as "15%".
 */
export const jackpotPercent = (pct: number): string => {
  const v = Number(pct);
  if (!Number.isFinite(v)) return '0';
  return String(Number(v.toFixed(2)));
};
