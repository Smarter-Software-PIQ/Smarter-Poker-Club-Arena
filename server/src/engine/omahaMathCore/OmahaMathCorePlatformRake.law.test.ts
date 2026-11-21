/**
 * The core nets a pot exactly as the platform deducts it (lane CORE-POOLED-4, CORE-AUDIT note 9).
 * Law: for every table rule (percent, flat cap, player-count cap tiers, jackpot drop, no flop no drop), every
 * dealt count and every pot, platformDeduction (the core's rake model, on by default through rake.platform)
 * equals rake + drop as the hand controller settles it (HandController.priceDeductions), cent for cent.
 * Synthetic configurations only; no hand, no cards.
 */
import { describe, expect, it } from 'vitest';
import { HandController } from '../HandController.js';
import type { HandConfig, SeatPlayer } from '../../types.js';
import { platformDeduction } from './OmahaMathCore.js';

function players(n: number): SeatPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    seat: i + 1,
    user_id: `u${i + 1}`,
    username: `P${i + 1}`,
    stack: 1000,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
}

type Rake = HandConfig['rakeConfig'];
type Bbj = HandConfig['bbjConfig'];
function controller(n: number, rakeConfig: Rake, bbjConfig: Bbj, flop: boolean): HandController {
  const cfg = {
    tableId: 'aaaaaaaa-1111-2222-3333-444444444444',
    handNumber: 1,
    gameVariant: 'plo5',
    smallBlind: 1,
    bigBlind: 2,
    rakeConfig,
    bbjConfig,
  } as HandConfig;
  const hc = new HandController(cfg, players(n), 1);
  hc.start();
  if (flop)
    (hc as unknown as { state: { communityCards: unknown[] } }).state.communityCards = [
      { rank: 'A', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
    ];
  return hc;
}

const RAKES: Rake[] = [];
for (const percent of [0, 3, 5, 10])
  for (const cap of [1.5, 4, 100])
    for (const tiers of [
      undefined,
      [
        { players: 2, cap: 1 },
        { players: 3, cap: 2.5 },
        { players: 5, cap: 4 },
      ],
    ])
      for (const noFlopNoDrop of [true, false])
        RAKES.push({
          percent,
          cap,
          noFlopNoDrop,
          ...(tiers ? { playerCountCaps: tiers } : {}),
        } as Rake);
const BBJS: Bbj[] = [
  undefined as unknown as Bbj,
  { enabled: false, feeBB: 0.5, minPotBB: 10, minPlayersDealt: 3 } as Bbj,
  { enabled: true, feeBB: 0.6, minPotBB: 10, minPlayersDealt: 3 } as Bbj,
  { enabled: true, feeBB: 2, minPotBB: 10, minPlayersDealt: 2 } as Bbj,
];
const POTS = [0.4, 1, 2.5, 3.33, 14.55, 25, 77.77, 500];

describe('the core rake model is the platform deduction', () => {
  it('matches HandController.priceDeductions for every rule, dealt count, pot, flop or not', () => {
    let checked = 0;
    for (const r of RAKES)
      for (const b of BBJS)
        for (const n of [2, 3, 4, 6, 9])
          for (const flop of [true, false]) {
            const hc = controller(n, r, b, flop);
            const drop =
              b?.enabled === true && n >= b.minPlayersDealt
                ? Math.round(2 * b.feeBB * 100) / 100
                : 0;
            const p = {
              config: {
                percent: r.percent,
                cap: r.cap,
                noFlopNoDrop: r.noFlopNoDrop !== false,
                ...(r.playerCountCaps ? { playerCountCaps: r.playerCountCaps } : {}),
              },
              players: n,
              bbjFee: drop,
            };
            for (const pot of POTS) {
              const want = hc.priceDeductions(flop, pot);
              const got = platformDeduction(p, pot, !flop);
              expect(got, JSON.stringify({ r, b, n, flop, pot })).toBeCloseTo(
                want.rake + want.bbjFee,
                9
              );
              checked++;
            }
          }
    expect(checked).toBe(RAKES.length * BBJS.length * 5 * 2 * POTS.length);
  });
});
