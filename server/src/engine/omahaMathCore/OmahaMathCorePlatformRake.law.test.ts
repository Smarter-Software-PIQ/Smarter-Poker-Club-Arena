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
import { omahaMathCoreState } from './OmahaMathCoreRule.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';

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

/**
 * Lane CORE-POOLED-5: the platform counts the seats that are not sitting out when it settles
 * (HandController.priceDeductions: players.filter((p) => !p.is_sitting_out).length) for the cap tier, the
 * heads-up ceiling and the jackpot drop. The core must count the same seats from the same flags, whatever the
 * dealt-seat census says: a dealt seat that is now sitting out is not a rated player.
 */
describe('a dealt seat that is sitting out is counted as the platform counts it', () => {
  const tiers = [
    { players: 2, cap: 1 },
    { players: 3, cap: 2.5 },
    { players: 4, cap: 4 },
  ];
  const rake = { percent: 5, cap: 100, noFlopNoDrop: true, playerCountCaps: tiers } as Rake;
  const bbj = { enabled: true, feeBB: 0.6, minPotBB: 10, minPlayersDealt: 4 } as Bbj;
  const card = (c: string) => ({
    rank: c[0],
    suit: { h: 'hearts', d: 'diamonds', s: 'spades', c: 'clubs' }[c[1] as 'h'],
  });
  for (const n of [3, 4])
    for (const census of [true, false])
      for (const allIn of [false, true])
        it(`${n} dealt, one now sitting out${allIn ? ' (all-in)' : ' (folded)'}, census ${census ? 'present' : 'absent'}`, () => {
          const hc = controller(n, rake, bbj, true);
          const st = (hc as unknown as { state: { players: SeatPlayer[] } }).state;
          const out = st.players.find((p) => p.seat === n)!;
          out.is_sitting_out = true;
          if (allIn) out.is_all_in = true;
          else out.is_folded = true;
          const players = st.players.map((p) => ({
            ...p,
            bet: 0,
            stack: p.seat === n && allIn ? 0 : 194,
            cards: p.seat === 1 ? ['Ah', 'Kd', 'Qs', '9h', '8c'].map(card) : [],
          })) as unknown as SeatPlayer[];
          const gs = {
            gameVariant: 'plo5',
            gameMode: 'cash',
            stage: 'flop',
            players,
            ...(census ? { dealtSeatIds: players.map((p) => p.seat) } : {}),
            dealerSeat: n,
            communityCards: ['Th', '7h', '2s'].map(card),
            pot: 8,
            currentBet: 0,
            toCall: 0,
            bigBlind: 2,
            chipUnit: 0.01,
            asset: 'chips',
            legalActions: ['check', 'bet'],
            actionHistory: [],
            rakeConfig: rake,
            bbjConfig: bbj,
          } as unknown as HorseGameStateV2;
          const core = omahaMathCoreState(players[0]!, gs);
          expect(core.rake?.platform?.players).toBe(n - 1);
          for (const pot of POTS) {
            const want = hc.priceDeductions(true, pot);
            expect(platformDeduction(core.rake!.platform!, pot, false), `pot ${pot}`).toBeCloseTo(
              want.rake + want.bbjFee,
              9
            );
          }
        });
});
