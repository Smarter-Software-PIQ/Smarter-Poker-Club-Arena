/**
 * Every built horse skill reaches HorseLogic.decide and says what happened
 * to its result (Dan, 2026-11-06: every built skill must be activated and
 * usable by all 1,000 horses). Three default-off skills were measured inert
 * in development; this law pins, with a pinned decision clock, that each one
 * is reached, changes the action when its condition holds, is a no-op
 * otherwise, and emits an applied / considered / superseded receipt.
 *
 * - barrelContinuationOutlook: the recorded turn outlook is consumed by the
 *   V7 river continuation (HorseLogic.decide), changing a check to a bet.
 * - smallPotNearNutRiverValue: reached on PLO heads-up cash rivers; its own
 *   development workload now opens the river at in-domain sizes.
 * - v53PloTourneyIcm: a production route exists (the shipped tournament
 *   flag selection, worker-owned) and stays off while unselected.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom, restoreFastRandom, saveFastRandom } from './HorseEval.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import {
  HORSE_TOURNAMENT_FLAG_CARD_NAMES,
  admitHorseTournamentFlagAuthority,
  admitHorseTournamentFlagReleaseAuthority,
  admittedTournamentFlag,
  runningTournamentFlagSourcePaths,
  tournamentFlagCardFor,
  type HorseTournamentFlagSelection,
} from './HorseTournamentFlagAuthority.js';
import { TOURNAMENT_FLAG_CARDS } from '../benchmark/HorseTournamentFlagContract.js';
import {
  NEAR_NUT_RIVER_POPULATION,
  incrementalDevelopmentDesign,
  incrementalDevelopmentSpec,
} from '../benchmark/IncrementalPressureDevelopment.js';
import { requestAt, workerHarness, wager } from '../testing/horseRegression/plan/fixture.js';
import { buildHorseDecisionKey } from './horseDecision/protocol.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const CLOCK = 1_793_127_540_000;
const c = (s: string): Card => ({
  rank: s[0] as Card['rank'],
  suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[s[1] as 'c'],
});
function fires(): string[] {
  return drainFires().map((f) => f.feature);
}
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

describe('barrelContinuationOutlook reaches the river barrel', () => {
  function turn() {
    const hist: ActionRecord[] = [
      { seat: 2, userId: 'hero', action: 'raise', amount: 6, timestamp: 900001, stage: 'preflop' },
      {
        seat: 5,
        userId: 'villain',
        action: 'call',
        amount: 6,
        timestamp: 900002,
        stage: 'preflop',
      },
      { seat: 2, userId: 'hero', action: 'bet', amount: 4, timestamp: 900003, stage: 'flop' },
      { seat: 5, userId: 'villain', action: 'call', amount: 4, timestamp: 900004, stage: 'flop' },
      { seat: 5, userId: 'villain', action: 'check', amount: 0, timestamp: 900005, stage: 'turn' },
    ];
    const hero: SeatPlayer = {
      seat: 2,
      user_id: 'hero',
      username: 'Horse',
      stack: 200,
      bet: 0,
      totalInvested: 10,
      cards: ['9c', '8c', 'Ah', 'Qh'].map(c),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const villain: SeatPlayer = { ...hero, seat: 5, user_id: 'villain', cards: [] };
    const gs = {
      players: [hero, villain],
      communityCards: ['Kd', '7s', '2c', '5h'].map(c),
      pot: 21,
      currentBet: 0,
      minRaise: 2,
      stage: 'turn' as const,
      gameVariant: 'plo4',
      bigBlind: 2,
      dealerSeat: 2,
      actionHistory: hist,
    };
    return { hero, hist, gs };
  }
  /** The full planned line: turn continuation, the effect commit, the river. */
  function line(flag: boolean | undefined, river: string, seed = 1) {
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
    const f = turn();
    HorseMind.notePlan(HorseMind.handKeyOf(f.hist)!, 'hero', true);
    seedFastRandom(seed);
    // The November 6 baseline river bluff range (HorseRiverBluffRange) now
    // owns a heads-up river with air when no candidate does. This law pins
    // the candidate against the brain it was built on, so the baseline is
    // ablated for both arms; with the flag on the baseline also yields to the
    // pending outlook in production (HorseLogic, BASELINE RIVER BLUFF RANGE).
    const opts: HorseDecideOpts = {
      telemetry: true,
      barrelContinuationOutlook: flag,
      riverBluffBaseline: false,
    };
    const t = HorseMind.captureDecisionEffects(() =>
      HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...opts, decisionTimeMs: CLOCK })
    );
    expect(t.value.action).toBe('bet');
    HorseMind.applyDecisionEffects(t.effects);
    const amt = t.value.amount!;
    const gs = {
      ...f.gs,
      stage: 'river',
      communityCards: [...f.gs.communityCards, c(river)],
      pot: 21 + 2 * amt,
      actionHistory: [
        ...f.hist,
        { seat: 2, userId: 'hero', action: 'bet', amount: amt, timestamp: 900006, stage: 'turn' },
        {
          seat: 5,
          userId: 'villain',
          action: 'call',
          amount: amt,
          timestamp: 900007,
          stage: 'turn',
        },
        {
          seat: 5,
          userId: 'villain',
          action: 'check',
          amount: 0,
          timestamp: 900008,
          stage: 'river',
        },
      ],
    };
    drainFires();
    seedFastRandom(seed + 1000);
    const r = HorseLogic.decide(
      { ...f.hero, stack: 200 - amt, totalInvested: 10 + amt },
      gs as never,
      'balanced',
      {},
      { ...opts, decisionTimeMs: CLOCK + 5000 }
    );
    return {
      action: r.action,
      amount: r.amount ?? null,
      next: saveFastRandom(),
      receipts: fires().filter((x) => x.startsWith('barrel_continuation_outlook_')),
    };
  }
  it('the carried turn outlook turns the river check into the planned barrel', () => {
    const on = line(true, '7h');
    const off = line(false, '7h');
    expect(off).toMatchObject({ action: 'check', receipts: [] });
    expect(on).toMatchObject({ action: 'bet', amount: 23 });
    expect(on.receipts).toEqual(['barrel_continuation_outlook_applied']);
  });
  it('is a no-op when off and when the same draw would choose the same', () => {
    expect(line(undefined, '7h')).toEqual(line(false, '7h'));
    // Seed 2 on the same card: the outlook is read, the draw keeps the choice.
    const on = line(true, '7h', 2);
    const off = line(false, '7h', 2);
    expect({ action: on.action, amount: on.amount }).toEqual({
      action: off.action,
      amount: off.amount,
    });
    expect(on.receipts.every((r) => r !== 'barrel_continuation_outlook_applied')).toBe(true);
  });
});

describe('smallPotNearNutRiverValue is reached on a PLO heads-up cash river', () => {
  function fixture() {
    const own = ['As', 'Qs', 'Qd', '8c', '7h'].map(c),
      board = ['7d', '7s', '5h', 'Qh', 'Kc'].map(c);
    const uid = (seat: number) => `near-nut-seat-${seat}`;
    const players = (
      [
        [1, 492.25, 0, 25, false],
        [3, 264.2, 0, 10, true],
        [4, 674.8, 0, 8, true],
        [5, 370.8, 0, 0, true],
        [6, 1215.03, 34, 59, false],
      ] as const
    ).map(([seat, stack, bet, totalInvested, folded]) => ({
      seat,
      user_id: uid(seat),
      username: 'Public fixture',
      stack,
      bet,
      totalInvested,
      is_folded: folded,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: seat !== 6,
      cards: seat === 1 ? own : [],
    }));
    const events = [
      ['preflop', 1, 'post_sb', 1],
      ['preflop', 3, 'post_bb', 2],
      ['preflop', 3, 'ante', 2],
      ['preflop', 4, 'raise', 8],
      ['preflop', 5, 'fold', 0],
      ['preflop', 6, 'call', 8],
      ['preflop', 1, 'call', 7],
      ['preflop', 3, 'call', 6],
      ['flop', 1, 'check', 0],
      ['flop', 3, 'check', 0],
      ['flop', 4, 'check', 0],
      ['flop', 6, 'bet', 17],
      ['flop', 1, 'call', 17],
      ['flop', 3, 'fold', 0],
      ['flop', 4, 'fold', 0],
      ['turn', 1, 'check', 0],
      ['turn', 6, 'check', 0],
      ['river', 1, 'check', 0],
      ['river', 6, 'bet', 34],
    ] as const;
    const gs = {
      gameMode: 'cash',
      format: 'cash',
      boardCount: 1,
      pots: [],
      players,
      communityCards: board,
      pot: 102,
      currentBet: 34,
      minRaise: 34,
      stage: 'river',
      gameVariant: 'plo5',
      bigBlind: 2,
      dealerSeat: 6,
      smallBlind: 1,
      actionHistory: events.map(([stage, seat, action, amount], i) => ({
        stage,
        seat,
        userId: uid(seat),
        action,
        amount,
        timestamp: 1793127540000 + i,
      })),
      dealtSeatIds: [1, 3, 4, 5, 6],
      heroSeat: 1,
      currentPlayerSeat: 1,
      legalActions: ['fold', 'call', 'raise'],
      toCall: 34,
      minRaiseTo: 68,
      maxRaiseTo: 170,
      bettingStructure: 'pot_limit',
      chipUnit: 0.01,
      asset: 'chips',
      bbjConfig: { enabled: true, feeBB: 0.25, minPotBB: 10, minPlayersDealt: 3 },
      rakeConfig: { percent: 10, cap: 5, noFlopNoDrop: true },
    };
    return { hero: players[0] as unknown as SeatPlayer, gs: gs as unknown as HorseGameStateV2 };
  }
  function decide(seed: number, flag: boolean | undefined, mutate?: (g: HorseGameStateV2) => void) {
    const { hero, gs } = fixture();
    mutate?.(gs);
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    const d = HorseLogic.decide(
      hero,
      gs,
      'balanced',
      {},
      {
        telemetry: true,
        decisionTimeMs: CLOCK,
        smallPotNearNutRiverValue: flag,
      }
    );
    return {
      action: d.action,
      amount: d.amount ?? null,
      next: saveFastRandom(),
      receipts: fires().filter((x) => x.startsWith('small_pot_near_nut_value_')),
    };
  }
  it('turns the random call into the value raise and records it applied', () => {
    for (const seed of [1, 2]) {
      const off = decide(seed, false);
      const on = decide(seed, true);
      expect(off.action).toBe('call');
      expect(on.action).toBe('raise');
      expect(on.receipts).toEqual(
        expect.arrayContaining([
          'small_pot_near_nut_value_raise',
          'small_pot_near_nut_value_applied',
        ])
      );
      expect(off.receipts).toEqual([]);
    }
  });
  it('is a no-op off, and outside its domain (a 0.75 pot opening bet)', () => {
    expect(decide(1, undefined)).toEqual(decide(1, false));
    const big = (g: HorseGameStateV2) => {
      g.currentBet = 51;
      g.toCall = 51;
      g.players[4].bet = 51;
      g.players[4].totalInvested = 76;
      g.pot = 119;
      g.actionHistory!.at(-1)!.amount = 51;
    };
    const on = decide(1, true, big),
      off = decide(1, false, big);
    expect({ ...on, receipts: [] }).toEqual({ ...off, receipts: [] });
    expect(on.receipts).toEqual([]);
  });
  it('its own development workload opens the river inside and outside the domain', () => {
    const spec = incrementalDevelopmentSpec(
      'small_pot_near_nut_value_raise',
      'plo5',
      'small_pot_near_nut_value_raise-plo5-6max-2dealt-100bb',
      { id: 'test-brain' } as never
    );
    expect(spec.population).toBe(NEAR_NUT_RIVER_POPULATION);
    expect(incrementalDevelopmentDesign('small_pot_near_nut_value_raise').population).toBe(
      'near_nut_mixed_river_open_stress_v1'
    );
    const { gs } = fixture();
    const fracs = new Set<number>();
    for (let i = 0; i < 60; i++) {
      let s = (i * 2654435761) >>> 0 || 1;
      const rng = () => (s = (s * 1103515245 + 12345) >>> 0) / 0x1_0000_0000;
      const g = {
        ...gs,
        currentBet: 0,
        toCall: 0,
        legalActions: ['check', 'bet'],
        minRaiseTo: 2,
        maxRaiseTo: 102,
        actionHistory: gs.actionHistory!.slice(0, -1),
      } as HorseGameStateV2;
      const villain = gs.players[4];
      const d = NEAR_NUT_RIVER_POPULATION.decide({ ...villain, bet: 0 }, g, rng);
      if (d.action === 'bet') fracs.add(Math.round((d.amount! / 102) * 100) / 100);
    }
    expect([...fracs].sort()).toEqual([0.33, 0.45, 0.75]);
  });
});

describe('v53PloTourneyIcm has a production activation route', () => {
  const fx = JSON.parse(
    readFileSync(new URL('./fixtures/v53-plo-tourney-icm-preflop.json', import.meta.url), 'utf8')
  );
  function decide(flag: boolean | undefined, mutate?: (g: HorseGameStateV2) => void) {
    const gs = structuredClone(fx.gameState);
    mutate?.(gs);
    enableBrainTelemetry();
    drainFires();
    restoreFastRandom(fx.rngState);
    const d = HorseLogic.decide(
      structuredClone(fx.player),
      gs,
      'balanced',
      {},
      {
        mind: false,
        telemetry: true,
        decisionTimeMs: CLOCK,
        v61RiverOnePairShade: false,
        v53PloTourneyIcm: flag,
      }
    );
    return {
      action: d.action,
      amount: d.amount ?? null,
      receipts: fires().filter((x) => x.startsWith('v53_plo_icm')),
    };
  }
  it('changes the PLO tournament preflop choice when on and records it applied', () => {
    const on = decide(true),
      off = decide(false);
    expect([on.action, on.amount]).toEqual(fx.flagOn);
    expect([off.action, off.amount]).toEqual(fx.flagOff);
    expect(on.receipts).toEqual(expect.arrayContaining(['v53_plo_icm', 'v53_plo_icm_applied']));
    expect(off.receipts).toEqual([]);
  });
  it('is a no-op off and outside tournaments', () => {
    expect(decide(undefined)).toEqual(decide(false));
    const cash = (g: HorseGameStateV2) => {
      g.gameMode = 'cash';
      g.format = 'cash';
    };
    const on = decide(true, cash),
      off = decide(false, cash);
    expect(on).toEqual(off);
  });
  it('the card names are the benchmark contract names', () => {
    expect([...HORSE_TOURNAMENT_FLAG_CARD_NAMES]).toEqual(TOURNAMENT_FLAG_CARDS.map((x) => x.name));
  });

  const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  function selected(mut: (s: HorseTournamentFlagSelection, files: Map<string, string>) => void) {
    const files = new Map<string, string>();
    const plan = JSON.stringify({
      schema: 'horse-tournament-flag-plan-v1',
      state: 'heldout_locked',
    });
    const verdict = JSON.stringify({ measured: true, wins: true, reasons: [], activation: false });
    files.set('docs/evidence/tournament-flag-activation/plan.json', plan);
    files.set('docs/evidence/tournament-flag-activation/plo4-mtt.json', verdict);
    const source = Object.fromEntries(runningTournamentFlagSourcePaths().map((p) => [p, sha(p)]));
    const s: HorseTournamentFlagSelection = {
      schema: 'horse-tournament-flag-selection-v1',
      flag: 'v53PloTourneyIcm',
      sourceSha: 'a'.repeat(40),
      plan: { path: 'docs/evidence/tournament-flag-activation/plan.json', sha256: sha(plan) },
      cards: [
        {
          card: 'plo4_v53_icm_mtt',
          path: 'docs/evidence/tournament-flag-activation/plo4-mtt.json',
          sha256: sha(verdict),
        },
      ],
      runtimeSourceFiles: source,
      approvalGeneration: 1,
      issuedAt: '2026-11-06T00:00:00.000Z',
      expiresAt: '2026-12-06T00:00:00.000Z',
      withdrawn: null,
    };
    mut(s, files);
    return admitHorseTournamentFlagAuthority(
      s,
      {
        read: (p) =>
          Buffer.from(
            files.get(p) ??
              (() => {
                throw Object.assign(Error('x'), { code: 'ENOENT' });
              })()
          ),
      },
      Date.parse('2026-11-07T00:00:00.000Z'),
      (p) => Buffer.from(p)
    );
  }
  it('the release ships no selection, so the flag is off everywhere', () => {
    const a = admitHorseTournamentFlagReleaseAuthority();
    expect(a).toEqual({ status: 'refused', reason: 'unselected' });
    expect(admittedTournamentFlag(a, fx.gameState)).toBe(false);
  });
  it('admits only a locked plan whose card verdicts won, bound to the running source', () => {
    const a = selected(() => {});
    expect(a.status).toBe('admitted');
    const at = Date.parse('2026-11-07T00:00:00.000Z');
    expect(tournamentFlagCardFor(fx.gameState)).toBe('plo4_v53_icm_mtt');
    expect(admittedTournamentFlag(a, fx.gameState, at)).toBe(true);
    expect(admittedTournamentFlag(a, { ...fx.gameState, format: 'sng' }, at)).toBe(false);
    expect(admittedTournamentFlag(a, { ...fx.gameState, gameMode: 'cash' }, at)).toBe(false);
    expect(admittedTournamentFlag(a, fx.gameState, Date.parse('2026-12-07T00:00:00.000Z'))).toBe(
      false
    );
    expect(
      selected((_, f) =>
        f.set(
          'docs/evidence/tournament-flag-activation/plan.json',
          JSON.stringify({
            schema: 'horse-tournament-flag-plan-v1',
            state: 'awaiting_protected_source_lock',
          })
        )
      ).status
    ).toBe('refused');
    expect(
      selected((s, f) => {
        const v = JSON.stringify({
          measured: true,
          wins: false,
          reasons: ['inert'],
          activation: false,
        });
        f.set(s.cards[0].path, v);
        s.cards[0].sha256 = sha(v);
      })
    ).toEqual({ status: 'refused', reason: 'not_qualified' });
    expect(
      selected((s) => (s.runtimeSourceFiles['src/engine/HorseLogic.ts'] = '0'.repeat(64)))
    ).toEqual({
      status: 'refused',
      reason: 'policy_digest_mismatch',
    });
    expect(
      selected((s) => (s.withdrawn = { at: '2026-11-06T01:00:00.000Z', reason: 'test' })).status
    ).toBe('withdrawn');
  });
  it('the worker owns the flag: a caller cannot turn it on', async () => {
    for (const admitted of [false, true]) {
      const seen: HorseDecideOpts[] = [];
      const h = workerHarness({
        admitTournamentFlagAuthority: () =>
          admitted
            ? {
                status: 'admitted',
                cards: ['plo4_v53_icm_mtt'],
                approvalGeneration: 1,
                sourceSha: 'a'.repeat(40),
                expiresAt: '2999-01-01T00:00:00.000Z',
              }
            : { status: 'refused', reason: 'unselected' },
        decide: (_p, _g, _s, _m, o) => {
          seen.push(o!);
          return wager();
        },
      });
      try {
        const r = requestAt();
        r.opts = { ...r.opts, v53PloTourneyIcm: true };
        r.decisionKey = buildHorseDecisionKey(r);
        await h.fast(r);
        // A cash request is outside every card, admitted or not.
        expect(seen.at(-1)!.v53PloTourneyIcm).toBe(false);
      } finally {
        await h.close();
      }
    }
  });
});
