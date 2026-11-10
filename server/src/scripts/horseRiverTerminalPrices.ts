/** Offline arithmetic only. No cards, controller, database, or policy activation. */
import { prepareJointPots, settleJointScores } from '../engine/multiway/JointPotDistribution.js';
import { applyJointDeductions } from '../engine/multiway/JointDeductions.js';
import type { SeatPlayer } from '../types.js';

export function riverTerminalPrices(input: {
  seats: number[][];
  lightningBbAnte?: true;
  heroSeat: number;
  dealerSeat: number;
  bigBlind: number;
  deductions: {
    version: number;
    status: string;
    rules: string;
    rake: { percent: number; cap: number; noFlopNoDrop: boolean; playerCountCaps: number[][] };
    bbj: { enabled: boolean; feeBB: number; minPlayersDealt: number; minPotBB: number };
  };
  bets: number[];
}) {
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (
    !Array.isArray(input.seats) ||
    (input.lightningBbAnte
      ? input.seats.length < 2 ||
        input.seats.length > 10 ||
        input.seats.filter((s) => s[6] === 0).length !== 2 ||
        !input.seats.some((s) => s[0] === input.heroSeat && s[6] === 0)
      : input.seats.length !== 2) ||
    !input.seats.every(
      (s) =>
        s.length === 7 &&
        s[2] === 0 &&
        s[5] === 0 &&
        (input.lightningBbAnte ? s[6] === 0 || s[6] === 1 : s[4] === 0 && s[6] === 0)
    ) ||
    (!input.lightningBbAnte &&
      (input.seats[0][3] !== input.seats[1][3] || input.heroSeat !== input.dealerSeat)) ||
    !input.seats.some((s) => s[0] === input.heroSeat) ||
    !Array.isArray(input.bets) ||
    input.bets.length > 32 ||
    !input.bets.every((b) => integer(b) && b > 0) ||
    input.deductions?.version !== 1 ||
    input.deductions.status !== 'captured' ||
    input.deductions.rules !== 'controller-rake-bbj-v1' ||
    (!input.lightningBbAnte &&
      input.deductions.bbj.enabled &&
      input.deductions.bbj.minPlayersDealt <= 2)
  )
    throw new Error('unsupported_river_terminal_context');
  const base = input.seats.map(
    (s) =>
      ({
        user_id: s[0] === input.heroSeat ? 'hero' : s[6] === 0 ? 'other' : `folded-${s[0]}`,
        seat: s[0],
        stack: s[1],
        bet: 0,
        totalInvested: s[3],
        deadInvested: s[4],
        individualAnteInvested: 0,
        cards: [],
        is_folded: s[6] === 1,
        is_all_in: false,
        is_sitting_out: false,
      }) as unknown as SeatPlayer
  );
  const hero = base.find((s) => s.user_id === 'hero')!;
  const other = base.find((s) => s.user_id === 'other')!;
  const rows = [];
  for (const bet of [0, ...input.bets]) {
    if (bet / 100 > hero.stack || bet / 100 > base.reduce((n, s) => n + s.totalInvested, 0))
      throw new Error('illegal_terminal_bet');
    for (const result of ['win', 'tie', 'loss', 'fold'] as const) {
      const seats = base.map((p) => ({ ...p }));
      for (const p of seats) {
        if (p.is_folded) continue;
        const paid =
          p.user_id === 'hero'
            ? bet / 100
            : result === 'fold'
              ? 0
              : Math.min(bet / 100, other.stack);
        p.stack -= paid;
        p.bet += paid;
        p.totalInvested += paid;
        p.is_folded = result === 'fold' && p.user_id === 'other';
      }
      const prepared = prepareJointPots(seats, 0.01);
      const settlement = settleJointScores({
        prepared,
        heroId: 'hero',
        opponentIds: ['other'],
        dealerSeat: input.dealerSeat,
        splitLow: false,
        sample: {
          boards: [
            {
              heroHigh: result === 'loss' ? 0 : 1,
              heroLow: null,
              opponentHigh: [result === 'win' ? 0 : 1],
              opponentLow: [null],
              opponentDecisionStrength: [
                0,
              ] /* Not read by settlement; no response policy is simulated. */,
            },
          ],
        },
      });
      const priced = applyJointDeductions({
        settlement,
        rakeConfig: {
          ...input.deductions.rake,
          playerCountCaps: input.deductions.rake.playerCountCaps.map(([players, cap]) => ({
            players,
            cap,
          })),
        },
        bbjConfig: input.deductions.bbj,
        asset: 'chips',
        gameMode: 'cash',
        bigBlind: input.bigBlind,
        dealtPlayers: base.length,
        sawFlop: true,
      });
      rows.push({
        bet,
        result,
        heroIncrementalUnits: Math.round((priced.netTotals.hero + priced.refunds.hero) * 100) - bet,
        rakeUnits: Math.round(priced.rake * 100),
        ...(input.lightningBbAnte ? { bbjUnits: Math.round(priced.bbjFee * 100) } : {}),
        refundUnits: Math.round(priced.refunds.hero * 100),
      });
    }
  }
  return rows;
}
