/**
 * Phase 3 (2026-11-02): EXACT replay of the 83 real no-limit hold'em hands in
 * which a horse 4-bet preflop and then folded to the re-raise, played by the
 * live (pre-rule-4) engine between 2026-11-02 04:00 and 16:00 UTC. Selected
 * from ca_hand_facts (four_bet, never saw the flop, not all in, lost chips),
 * then each hand's own recorded actions were parsed: the fixture holds, for
 * every hand, the public table snapshot the engine recorded at the horse's
 * real 4-bet and at its real fold (seats, stacks, street bets, pot, antes,
 * dealer, legal actions, raise bounds, tournament stage), the action history
 * up to each node and the horse's hole cards. Seats and players are
 * anonymised to seat numbers. 58 cash, 25 tournament; 82 of the 83 re-raises
 * came from the 3-bettor and 70 were all in.
 *
 * Today's brain is run at both real nodes for every style over 10 seeds,
 * with the opponent-memory module off (mind: false) so the replay is
 * deterministic; the live brain also consults opponent reads, which can only
 * be judged after release.
 *
 * The law: for no hand and no style does today's brain both make a
 * non-all-in raise at the real 4-bet node AND fold at the real 5-bet node.
 * Also pinned: the module that makes the difference is the premium-aggression
 * module (rules 1, 2, 4, 4a, 4b; HorseHoldemPremiumAggression): with it off,
 * the same replay reproduces the leak, so the law is not vacuous; and rule 4b
 * (a re-raised 4-bettor continues at the price) is reached at the real 5-bet
 * nodes, so the closure is not only "never 4-bet".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card, SeatPlayer } from '../types.js';
import FIXTURE from './HorseFourBetThenFoldRealHands.fixture.json';

interface Node {
  pot: number;
  ante: number | null;
  anteType: string | null;
  /** [seat, behind, street bet, hand total, dead ante, -, status 0 live / 1 folded / 2 all in] */
  seats: number[][];
  toCall: number;
  currentBet: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  legalActions: string[];
  dealerSeat: number;
  chipUnit: 0.01 | 1;
  bigBlind: number;
  smallBlind: number;
  mode: 'cash' | 'tournament';
  tournamentStage?: Record<string, unknown>;
}
interface RealHand {
  handId: string;
  fmt: 'cash' | 'tour';
  heroSeat: number;
  hole: Card[];
  raiseOrd: number;
  foldOrd: number;
  actions: Array<{
    ord: number;
    seat: number;
    action: string;
    amount: number;
    isFullRaise: boolean;
    dead: boolean;
  }>;
  node4: Node;
  node5: Node;
}
const HANDS = FIXTURE as unknown as RealHand[];
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31];
const STYLES = ['tag', 'lag', 'balanced', 'tricky', 'grinder'] as const;

/** The game state the engine saw at `node`, with history strictly before `ord`. */
function stateAt(h: RealHand, node: Node, ord: number) {
  const players = node.seats.map(
    ([seat, behind, bet, total, , , status]) =>
      ({
        seat,
        user_id: `p${seat}`,
        username: `p${seat}`,
        stack: behind,
        bet,
        totalInvested: total,
        cards: seat === h.heroSeat ? h.hole : [],
        is_folded: status === 1,
        is_all_in: status === 2,
        is_sitting_out: false,
        is_horse: true,
      }) as SeatPlayer
  );
  const hero = players.find((p) => p.seat === h.heroSeat)!;
  const ts = node.tournamentStage;
  const gs = {
    players,
    communityCards: [],
    pot: node.pot,
    currentBet: node.currentBet,
    toCall: node.toCall,
    minRaiseTo: node.minRaiseTo,
    maxRaiseTo: node.maxRaiseTo,
    legalActions: node.legalActions,
    stage: 'preflop',
    gameVariant: 'nlh',
    gameMode: node.mode,
    bettingStructure: 'no_limit',
    bigBlind: node.bigBlind,
    smallBlind: node.smallBlind,
    ante: node.ante ?? 0,
    bigBlindAnte: node.anteType === 'big_blind',
    dealerSeat: node.dealerSeat,
    chipUnit: node.chipUnit,
    heroSeat: h.heroSeat,
    currentPlayerSeat: h.heroSeat,
    actionHistory: h.actions
      .filter((a) => a.ord < ord)
      .map((a) => ({
        stage: 'preflop',
        seat: a.seat,
        userId: `p${a.seat}`,
        action: a.action,
        amount: a.amount,
        isFullRaise: a.isFullRaise,
        ...(a.dead ? { dead: true } : {}),
      })),
    ...(node.mode === 'tournament' && ts
      ? {
          tournament: {
            ...ts,
            currentBigBlind: node.bigBlind,
            currentSmallBlind: node.smallBlind,
            currentAnte: node.ante ?? 0,
            anteType: node.anteType ?? undefined,
            playersAtTable: node.seats.length,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

function act(
  s: ReturnType<typeof stateAt>,
  seed: number,
  style: (typeof STYLES)[number],
  opts: Record<string, unknown>
) {
  seedFastRandom(seed);
  HorseMind.reset();
  return HorseLogic.decide(s.hero, s.gs, style, {}, { mind: false, ...opts } as never);
}

function replay(opts: Record<string, unknown> = {}) {
  const paths: string[] = [];
  let continued = 0;
  let fourBetNow = 0;
  for (const h of HANDS) {
    const at4 = stateAt(h, h.node4, h.raiseOrd);
    const at5 = stateAt(h, h.node5, h.foldOrd);
    for (const style of STYLES) {
      const raises = SEEDS.filter((seed) => {
        const d = act(at4, seed, style, opts);
        return d.action === 'raise';
      }).length;
      const answers = SEEDS.map((seed) => act(at5, seed, style, opts).action);
      const folds = answers.filter((a) => a === 'fold').length;
      continued += answers.length - folds;
      fourBetNow += raises;
      if (raises > 0 && folds > 0)
        paths.push(
          `${h.fmt} ${h.handId} ${h.hole.map((c) => c.rank + c.suit[0]).join('')} ${style}: raises ${raises}/10 at the 4-bet node, folds ${folds}/10 to the re-raise`
        );
    }
  }
  return { paths, continued, fourBetNow };
}

describe("Phase 3: the 83 real 4-bet-then-fold hands, replayed exactly through today's brain", () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded sample: 83 hands, 58 cash, both real nodes present', () => {
    expect(HANDS).toHaveLength(83);
    expect(HANDS.filter((h) => h.fmt === 'cash')).toHaveLength(58);
    for (const h of HANDS) {
      expect(h.raiseOrd).toBeLessThan(h.foldOrd);
      expect(h.node4.seats.some((s) => s[0] === h.heroSeat)).toBe(true);
      expect(h.node5.toCall).toBeGreaterThan(0);
      expect(h.node5.legalActions).toContain('fold');
      // The recorded history really is: hero raised at raiseOrd and folded at foldOrd.
      expect(h.actions.find((a) => a.ord === h.raiseOrd)?.action).toBe('raise');
      expect(h.actions.find((a) => a.ord === h.foldOrd)?.action).toBe('fold');
    }
  });

  it('no hand and no style both raises (not all in) at the real 4-bet node and folds at the real 5-bet node', () => {
    expect(replay().paths).toEqual([]);
  });

  it("rule 4b is reached: at the real 5-bet nodes today's brain continues in some hands", () => {
    expect(replay().continued).toBeGreaterThan(0);
  });

  it('control: with the premium-aggression module (rules 1, 2, 4, 4a, 4b) off, the replay reproduces the leak', () => {
    expect(replay({ holdemPremiumAggression: false }).paths.length).toBeGreaterThan(0);
  });

  describe('rule 4a prices every voluntary opponent who can still jam (the opener path)', () => {
    const real = HANDS.find((h) => h.handId.startsWith('d4ec1ccd'))!;
    const raisesAt = (node: Node) => {
      const st = stateAt(real, node, real.raiseOrd);
      return STYLES.flatMap((style) => SEEDS.map((seed) => act(st, seed, style, {}).action)).filter(
        (a) => a === 'raise'
      ).length;
    };
    const withSeat = (seat: number, edit: (row: number[]) => number[]): Node => ({
      ...real.node4,
      seats: real.node4.seats.map((row) => (row[0] === seat ? edit([...row]) : row)),
    });

    it('the recorded hand: QQ in the big blind, a ~189bb opener and a ~123bb 3-bettor; a style that still 4-bets calls the jam, the others flat', () => {
      expect(real.hole.map((c) => c.rank).join('')).toBe('QQ');
      const at4 = stateAt(real, real.node4, real.raiseOrd);
      const at5 = stateAt(real, real.node5, real.foldOrd);
      let flatted = 0;
      for (const style of STYLES) {
        const raises = SEEDS.filter((seed) => act(at4, seed, style, {}).action === 'raise').length;
        if (raises === 0) flatted++;
        else
          expect(
            SEEDS.filter((seed) => act(at5, seed, style, {}).action === 'fold').length,
            style
          ).toBe(0);
      }
      expect(flatted).toBeGreaterThan(0);
      // Pricing the opener's deeper stack is what removed those 4-bets.
      const shortOpener = withSeat(4, (r) => [r[0], 57.62, r[2], r[3], r[4], r[5], r[6]]);
      expect(raisesAt(real.node4)).toBeLessThan(raisesAt(shortOpener));
    });

    it('with the opener as short as the 3-bettor (both covered by the 4-bet price), QQ 4-bets again', () => {
      // Opener seat 4: 93.45 behind + 1.07 in becomes 57.62 behind + 1.07 in.
      expect(
        raisesAt(withSeat(4, (r) => [r[0], 57.62, r[2], r[3], r[4], r[5], r[6]]))
      ).toBeGreaterThan(0);
    });

    it('a deep player who has not acted is not priced: the short-opener answer is unchanged by one', () => {
      const shortOpener = withSeat(4, (r) => [r[0], 57.62, r[2], r[3], r[4], r[5], r[6]]);
      // Seat 3 folded in the real hand; make it a live 400bb player yet to act.
      const deepBehind: Node = {
        ...shortOpener,
        seats: shortOpener.seats.map((r) => (r[0] === 3 ? [3, 200, 0, 0, 0, 0, 0] : r)),
      };
      const real3 = {
        ...real,
        actions: real.actions.filter((a) => !(a.seat === 3 && a.action === 'fold')),
      };
      const st = (node: Node) => stateAt(real3, node, real.raiseOrd);
      const count = (node: Node) =>
        STYLES.flatMap((style) =>
          SEEDS.map((seed) => act(st(node), seed, style, {}).action)
        ).filter((a) => a === 'raise').length;
      expect(count(deepBehind)).toBe(count(shortOpener));
    });
  });
});
