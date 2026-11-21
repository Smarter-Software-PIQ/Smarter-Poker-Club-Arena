import { describe, expect, it } from 'vitest';
import { HorseMind } from '../engine/HorseMind.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from '../engine/HorseComplaintReplay.js';
import KK from '../engine/horseComplaints/kk-three-bettor-folds-to-a-4-bet.fixture.json';
import {
  AsOfOpponentMemory,
  cardOf,
  decisionTimeMs,
  facingOf,
  historyHandOf,
  historyTimeMs,
  replayAtWithMemory,
  withSeatIds,
  type HistoryHand,
} from './ReplayOpponentMemory.js';

const TABLE = '5acb1bb5-7542-43ab-bee7-1974e31a3db0';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** A settled heads-up preflop hand: `opener` raises, `folder` folds. Public actions only. */
function hand(i: number, settledAtMs: number, opener: string, folder: string): HistoryHand {
  const t = settledAtMs - 5_000;
  return {
    id: uuid(i),
    settledAtMs,
    variant: 'nlh',
    tableId: TABLE,
    handNumber: 1_000_000 + i,
    tournament: false,
    speed: 'table',
    bigBlind: 2,
    board: [],
    showdown: null,
    dealt: 2,
    players: [
      { seat: 1, userId: opener },
      { seat: 2, userId: folder },
    ],
    actions: [
      {
        seat: 1,
        userId: opener,
        action: 'sb',
        amount: 1,
        stage: 'preflop',
        timestamp: t,
        origin: 'forced',
      },
      {
        seat: 2,
        userId: folder,
        action: 'bb',
        amount: 2,
        stage: 'preflop',
        timestamp: t + 1,
        origin: 'forced',
      },
      {
        seat: 1,
        userId: opener,
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: t + 2,
        origin: 'player',
        isFullRaise: true,
      },
      {
        seat: 2,
        userId: folder,
        action: 'fold',
        amount: 0,
        stage: 'preflop',
        timestamp: t + 3,
        origin: 'player',
      },
    ],
  };
}

const statsOf = (m: AsOfOpponentMemory, u: string) =>
  HorseMind.runInSandbox(m.sandbox, () => HorseMind.getStats(u));

describe('ReplayOpponentMemory: a record built at time t holds no hand settled at or after t', () => {
  it('learns only hands settled strictly before t, never the excluded hand, and only forward', () => {
    const hs = [
      hand(1, 1_000_000, 'person-a', 'horse-b'),
      hand(2, 2_000_000, 'person-a', 'horse-b'),
      hand(3, 2_500_000, 'person-a', 'horse-b'), // settles exactly at t: excluded (strict)
      hand(4, 3_000_000, 'person-c', 'horse-b'), // person-c plays only after t
    ];
    const m = new AsOfOpponentMemory([...hs].reverse());
    expect(m.learnThrough(2_500_000, uuid(2))).toBe(1);
    expect(m.learned).toEqual([uuid(1)]);
    expect(m.latestLearnedMs).toBeLessThan(2_500_000);
    expect(m.handsOf.get('person-a')).toBe(1);
    expect(statsOf(m, 'person-a')?.hands).toBe(1);
    // the future player is unknown at t, his hand is not in anyone's record
    expect(statsOf(m, 'person-c')).toBeUndefined();
    expect(m.handsOf.get('person-c')).toBeUndefined();
    expect(() => m.learnThrough(2_400_000)).toThrow(/backwards/);
    // later: the hand at t and person-c's hand arrive, the excluded hand never does
    m.learnThrough(3_000_001);
    expect(m.learned).toEqual([uuid(1), uuid(3), uuid(4)]);
    expect(statsOf(m, 'person-a')?.hands).toBe(2);
    expect(statsOf(m, 'person-c')?.hands).toBe(1);
  });

  it('holds for every decision time of a random history (no learned hand at or after t, every earlier hand in)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const hs = Array.from({ length: 120 }, (_, i) =>
      hand(i + 10, 1_000_000 + Math.floor(rnd() * 9_000_000), `p${i % 7}`, `h${i % 5}`)
    );
    const times = Array.from({ length: 40 }, () => 1_000_000 + Math.floor(rnd() * 9_500_000)).sort(
      (a, b) => a - b
    );
    const m = new AsOfOpponentMemory(hs);
    const at = new Map(hs.map((h) => [h.id, h.settledAtMs]));
    for (const t of times) {
      m.learnThrough(t);
      expect(m.learned.every((id) => at.get(id)! < t)).toBe(true);
      expect(m.learned.length).toBe(hs.filter((h) => h.settledAtMs < t).length);
    }
  });

  it('reads the pulled rows: public columns, Postgres time, card text', () => {
    expect(historyTimeMs('2026-11-19 00:29:17.005236+00')).toBe(
      Date.parse('2026-11-19T00:29:17.005Z')
    );
    expect(cardOf('10spades')).toEqual({ rank: 'T', suit: 'spades' });
    expect(cardOf('Kh')).toEqual({ rank: 'K', suit: 'hearts' });
    expect(cardOf('xx')).toBeNull();
    const h = historyHandOf({
      id: uuid(9),
      created_at: '2026-11-19 00:29:17.005236+00',
      gv: 'plo5',
      tid: TABLE,
      hn: 60033941,
      tourney: false,
      pmd: { speed: 'lightning' },
      bb: 2,
      cc: ['7hearts', '4spades', '2hearts'],
      sd: [{ seat: 2, mucked: false, user_id: 'u', hand_name: 'Three of a Kind' }],
      np: 6,
      pl: [{ seat: 2, userId: 'u' }],
      act: [{ seat: 2 }],
    });
    expect(h?.speed).toBe('lightning');
    expect(h?.board).toHaveLength(3);
    expect(h?.showdown).toEqual([{ user_id: 'u', mucked: false, hand_name: 'Three of a Kind' }]);
    expect(historyHandOf({ id: uuid(9), created_at: 'x', act: [{}] })).toBeNull();
  });
});

describe('ReplayOpponentMemory: the decision reads the record without changing it', () => {
  // The committed KK complaint as an extracted hand: seat 4 is a person, the Horse in seat 1 decides at ord 11.
  const fx = KK as unknown as {
    variant: string;
    hole: Record<string, ExtractedHand['horseHoleCards'][string]>;
    actions: ComplaintAction[];
  };
  const ids = ['', 'h1', 'h2', 'h3', 'person-4', 'h5', 'h6'];
  const extracted: ExtractedHand = {
    handId: uuid(99),
    variant: fx.variant,
    bigBlind: 2,
    smallBlind: 1,
    players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, userId: ids[seat], isHorse: seat !== 4 })),
    horseHoleCards: { h1: fx.hole['1'] },
    actions: fx.actions.map((a) => ({ ...a, userId: ids[a.seat] })),
  };
  const node = extracted.actions.find((a) => a.ord === 11)!;

  it('facing: who is live against the decider, by kind', () => {
    const f = facingOf(extracted, node)!;
    expect(f.opponents.map((o) => o.seat)).toEqual([4]);
    expect(f.kind).toBe('people');
    const allHorses = {
      ...extracted,
      players: extracted.players.map((p) => ({ ...p, isHorse: true })),
    };
    expect(facingOf(allHorses, node)!.kind).toBe('horse_only');
  });

  it('real seat ids replace p<seat>; public seats still carry no cards', () => {
    const st = withSeatIds(stateAt(extracted, node), extracted);
    expect(st.hero.user_id).toBe('h1');
    const players = (st.gs as unknown as { players: Array<{ user_id: string; cards: unknown[] }> })
      .players;
    expect(players.map((p) => p.user_id)).toContain('person-4');
    expect(players.every((p) => p.cards.length === 0)).toBe(true);
    const hist = (st.gs as unknown as { actionHistory: Array<{ userId: string }> }).actionHistory;
    expect(hist.every((a) => !/^p\d$/.test(a.userId))).toBe(true);
  });

  it('two looks at one node give one answer and leave the record as it was', () => {
    const m = new AsOfOpponentMemory(
      Array.from({ length: 30 }, (_, i) => hand(200 + i, 1_000_000 + i * 1000, 'person-4', 'h1'))
    );
    m.learnThrough(2_000_000);
    expect(statsOf(m, 'person-4')?.hands).toBe(30);
    const before = JSON.stringify([...m.sandbox.stats.entries()]);
    const st = withSeatIds(stateAt(extracted, node), extracted);
    const prof = replayProfiles('cash').find((p) => p.live)!;
    const a = replayAtWithMemory(m, st, prof, [1, 7, 42]);
    const b = replayAtWithMemory(m, st, prof, [1, 7, 42]);
    expect(a.kinds).toEqual(b.kinds);
    expect(JSON.stringify([...m.sandbox.stats.entries()])).toBe(before);
    // and the process-wide memory never saw the person
    expect(HorseMind.getStats('person-4')).toBeUndefined();
  });

  it('decision time is the recorded action timestamp', () => {
    expect(decisionTimeMs({ ...node, timestamp: 1794966586488 } as ComplaintAction)).toBe(
      1794966586488
    );
    expect(decisionTimeMs(node)).toBeNull();
  });
});

describe('ReplayOpponentMemory: publicMemoryDomain propagates through stateAt and withSeatIds', () => {
  /** A 6-handed postflop hand settled strictly before the decision where `villain` faces a turn bet
   *  and either calls (passive) or raises (aggressive), tagged with `speed` ('lightning' | 'table'). */
  function postflopTurnHand(
    i: number,
    settledAtMs: number,
    villain: string,
    hero: string,
    speed: 'lightning' | 'table',
    villainRaisesTurn: boolean
  ): HistoryHand {
    const t = settledAtMs - 5_000;
    return {
      id: uuid(i),
      settledAtMs,
      variant: 'nlh',
      tableId: TABLE,
      handNumber: 2_000_000 + i,
      tournament: false,
      speed,
      bigBlind: 2,
      board: [
        { rank: 'K', suit: 'spades' },
        { rank: '9', suit: 'diamonds' },
        { rank: '4', suit: 'clubs' },
        { rank: '2', suit: 'hearts' },
      ],
      showdown: null,
      dealt: 6,
      players: [
        { seat: 1, userId: hero },
        { seat: 2, userId: 'h2' },
        { seat: 3, userId: 'h3' },
        { seat: 4, userId: villain },
        { seat: 5, userId: 'h5' },
        { seat: 6, userId: 'h6' },
      ],
      actions: [
        {
          seat: 2,
          userId: 'h2',
          action: 'sb',
          amount: 1,
          stage: 'preflop',
          timestamp: t,
          origin: 'forced',
        },
        {
          seat: 3,
          userId: 'h3',
          action: 'bb',
          amount: 2,
          stage: 'preflop',
          timestamp: t + 1,
          origin: 'forced',
        },
        {
          seat: 4,
          userId: villain,
          action: 'call',
          amount: 2,
          stage: 'preflop',
          timestamp: t + 2,
          origin: 'player',
        },
        {
          seat: 1,
          userId: hero,
          action: 'call',
          amount: 2,
          stage: 'preflop',
          timestamp: t + 3,
          origin: 'horse_policy',
        },
        {
          seat: 3,
          userId: 'h3',
          action: 'check',
          amount: 0,
          stage: 'preflop',
          timestamp: t + 4,
          origin: 'horse_policy',
        },
        {
          seat: 4,
          userId: villain,
          action: 'check',
          amount: 0,
          stage: 'flop',
          timestamp: t + 5,
          origin: 'player',
        },
        {
          seat: 1,
          userId: hero,
          action: 'check',
          amount: 0,
          stage: 'flop',
          timestamp: t + 6,
          origin: 'horse_policy',
        },
        {
          seat: 4,
          userId: villain,
          action: 'check',
          amount: 0,
          stage: 'turn',
          timestamp: t + 7,
          origin: 'player',
        },
        {
          seat: 1,
          userId: hero,
          action: 'bet',
          amount: 4,
          stage: 'turn',
          timestamp: t + 8,
          origin: 'horse_policy',
          isFullRaise: true,
        },
        villainRaisesTurn
          ? {
              seat: 4,
              userId: villain,
              action: 'raise',
              amount: 16,
              stage: 'turn',
              timestamp: t + 9,
              origin: 'player',
              isFullRaise: true,
            }
          : {
              seat: 4,
              userId: villain,
              action: 'call',
              amount: 4,
              stage: 'turn',
              timestamp: t + 9,
              origin: 'player',
            },
        {
          seat: 1,
          userId: hero,
          action: 'fold',
          amount: 0,
          stage: 'turn',
          timestamp: t + 10,
          origin: 'horse_policy',
        },
      ],
    };
  }

  function turnCheckRaiseHand(
    publicMemoryDomain?: {
      readonly version: 1;
      readonly speed: 'table' | 'lightning';
      readonly ante: 'none' | 'individual' | 'big_blind';
    } | null
  ): { hand: ExtractedHand; node: ComplaintAction } {
    const ids = ['', 'h1', 'h2', 'h3', 'person-4', 'h5', 'h6'];
    const actions: ComplaintAction[] = [
      {
        ord: 0,
        seat: 2,
        userId: 'h2',
        stage: 'preflop',
        action: 'sb',
        amount: 1,
        origin: 'forced',
      },
      {
        ord: 1,
        seat: 3,
        userId: 'h3',
        stage: 'preflop',
        action: 'bb',
        amount: 2,
        origin: 'forced',
      },
      {
        ord: 2,
        seat: 4,
        userId: 'person-4',
        stage: 'preflop',
        action: 'call',
        amount: 2,
        origin: 'player',
      },
      {
        ord: 3,
        seat: 5,
        userId: 'h5',
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
      },
      {
        ord: 4,
        seat: 6,
        userId: 'h6',
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
      },
      {
        ord: 5,
        seat: 1,
        userId: 'h1',
        stage: 'preflop',
        action: 'raise',
        amount: 8,
        origin: 'horse_policy',
        isFullRaise: true,
      },
      {
        ord: 6,
        seat: 2,
        userId: 'h2',
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
      },
      {
        ord: 7,
        seat: 3,
        userId: 'h3',
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
      },
      {
        ord: 8,
        seat: 4,
        userId: 'person-4',
        stage: 'preflop',
        action: 'call',
        amount: 6,
        origin: 'player',
      },
      {
        ord: 9,
        seat: 4,
        userId: 'person-4',
        stage: 'flop',
        action: 'check',
        amount: 0,
        origin: 'player',
      },
      {
        ord: 10,
        seat: 1,
        userId: 'h1',
        stage: 'flop',
        action: 'check',
        amount: 0,
        origin: 'horse_policy',
      },
      {
        ord: 11,
        seat: 4,
        userId: 'person-4',
        stage: 'turn',
        action: 'check',
        amount: 0,
        origin: 'player',
      },
      {
        ord: 12,
        seat: 1,
        userId: 'h1',
        stage: 'turn',
        action: 'bet',
        amount: 10,
        origin: 'horse_policy',
        isFullRaise: true,
      },
      {
        ord: 13,
        seat: 4,
        userId: 'person-4',
        stage: 'turn',
        action: 'raise',
        amount: 40,
        origin: 'player',
        isFullRaise: true,
      },
      {
        ord: 14,
        seat: 1,
        userId: 'h1',
        stage: 'turn',
        action: 'call',
        amount: 30,
        origin: 'horse_policy',
        publicNode: {
          pot: 69,
          ante: publicMemoryDomain?.ante === 'big_blind' ? 2 : 0,
          anteType: publicMemoryDomain?.ante === 'big_blind' ? 'big_blind' : null,
          mode: 'cash',
          seats: [
            [1, 500, 10, 18, 0, 0, 0],
            [2, 199, 0, 1, 0, 0, 1],
            [3, 198, 0, 2, 0, 0, 1],
            [4, 500, 40, 48, 0, 0, 0],
            [5, 200, 0, 0, 0, 0, 1],
            [6, 200, 0, 0, 0, 0, 1],
          ],
          boards: ['Ks9d4c2h'],
          street: 'turn',
          toCall: 30,
          currentBet: 40,
          minRaiseTo: 70,
          maxRaiseTo: 510,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          dealerSeat: 1,
          chipUnit: 0.01,
          bigBlind: 2,
          smallBlind: 1,
          variant: 'nlh',
          structure: 'no_limit',
          actorSeat: 1,
        },
      },
    ];
    const hand: ExtractedHand = {
      handId: uuid(500),
      variant: 'nlh',
      bigBlind: 2,
      smallBlind: 1,
      ...(publicMemoryDomain !== undefined ? { publicMemoryDomain } : {}),
      players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, userId: ids[seat], isHorse: seat !== 4 })),
      horseHoleCards: {
        h1: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'diamonds' },
        ],
      },
      actions,
    };
    return { hand, node: actions[actions.length - 1] };
  }

  it('lightningStyleReadSeparate fires style_lightning_separate_read_seen on a replayed Lightning node with multi-domain history, and stays unchanged on Classic table nodes', () => {
    const history: HistoryHand[] = [
      // 35 Lightning hands: person-4 is passive on the turn (calls, never raises)
      ...Array.from({ length: 35 }, (_, i) =>
        postflopTurnHand(1000 + i, 1_000_000 + i * 1_000, 'person-4', 'h1', 'lightning', false)
      ),
      // 25 Classic table hands: person-4 is aggressive on the turn (raises every turn)
      ...Array.from({ length: 25 }, (_, i) =>
        postflopTurnHand(2000 + i, 1_100_000 + i * 1_000, 'person-4', 'h1', 'table', true)
      ),
    ];
    const mem = new AsOfOpponentMemory(history);
    mem.learnThrough(2_000_000);
    const prof = replayProfiles('cash').find((p) => p.live)!;

    // 1. Lightning node: publicMemoryDomain propagates through stateAt -> withSeatIds and activates
    //    lightningStyleReadSeparate, emitting style_lightning_separate_read_seen.
    const lightningDomain = {
      version: 1 as const,
      speed: 'lightning' as const,
      ante: 'big_blind' as const,
    };
    const { hand: lHand, node: lNode } = turnCheckRaiseHand(lightningDomain);
    const lState = withSeatIds(stateAt(lHand, lNode), lHand);
    expect(lState.gs.publicMemoryDomain).toEqual(lightningDomain);
    const lSeparate = replayAtWithMemory(mem, lState, prof, [1, 7, 42], {
      styleRaiseRespect: true,
      lightningStyleReadSeparate: true,
    });
    expect(lSeparate.receipts.style_lightning_separate_read_seen ?? 0).toBeGreaterThan(0);

    // 2. Classic table node: publicMemoryDomain propagates as speed='table'; lightningStyleReadSeparate
    //    is a no-op and emits zero Lightning-separate receipts.
    const tableDomain = { version: 1 as const, speed: 'table' as const, ante: 'none' as const };
    const { hand: cHand, node: cNode } = turnCheckRaiseHand(tableDomain);
    const cState = withSeatIds(stateAt(cHand, cNode), cHand);
    expect(cState.gs.publicMemoryDomain).toEqual(tableDomain);
    const cOff = replayAtWithMemory(mem, cState, prof, [1, 7, 42], {
      styleRaiseRespect: true,
    });
    const cOn = replayAtWithMemory(mem, cState, prof, [1, 7, 42], {
      styleRaiseRespect: true,
      lightningStyleReadSeparate: true,
    });
    expect(cOn.kinds).toEqual(cOff.kinds);
    expect(cOn.actions).toEqual(cOff.actions);
    expect(cOn.receipts.style_lightning_separate_read_seen ?? 0).toBe(0);
    expect(cOn.receipts.style_lightning_separate_empty_seen ?? 0).toBe(0);

    // 3. Absent or invalid publicMemoryDomain stays undefined (backwards-compatible).
    const { hand: uHand, node: uNode } = turnCheckRaiseHand(undefined);
    expect(withSeatIds(stateAt(uHand, uNode), uHand).gs.publicMemoryDomain).toBeUndefined();
    const { hand: badHand, node: badNode } = turnCheckRaiseHand({
      version: 1,
      speed: 'bogus' as 'table',
      ante: 'none',
    });
    expect(withSeatIds(stateAt(badHand, badNode), badHand).gs.publicMemoryDomain).toBeUndefined();
  });

  it('AsOfOpponentMemory isolates and populates pooled vs Lightning style maps in its sandbox without static bleed', () => {
    const lightningDomain = {
      version: 1 as const,
      speed: 'lightning' as const,
      ante: 'big_blind' as const,
    };
    // 200 Lightning hands where Horse h5 faces a turn bet (raises 20/200 = 10%) so the in-format
    // Horse reference reaches streetRaiseReferenceMinOpps (200) purely via AsOfOpponentMemory.learn().
    // Also includes 120 preflop-fold hands for person-4 so person-4 has realistic ~25% VPIP.
    const horseRefHand = (idx: number, t: number, horseRaises: boolean): HistoryHand => ({
      id: uuid(idx),
      settledAtMs: t,
      variant: 'nlh',
      tableId: TABLE,
      handNumber: 3_000_000 + idx,
      tournament: false,
      speed: 'lightning',
      bigBlind: 2,
      board: [
        { rank: 'K', suit: 'spades' },
        { rank: '9', suit: 'diamonds' },
        { rank: '4', suit: 'clubs' },
        { rank: '2', suit: 'hearts' },
      ],
      showdown: null,
      dealt: 6,
      players: [
        { seat: 1, userId: 'h1' },
        { seat: 2, userId: 'h2' },
        { seat: 3, userId: 'h3' },
        { seat: 4, userId: 'person-4' },
        { seat: 5, userId: 'h5' },
        { seat: 6, userId: 'h6' },
      ],
      actions: [
        {
          stage: 'preflop',
          seat: 2,
          userId: 'h2',
          action: 'sb',
          amount: 1,
          origin: 'forced',
          timestamp: t - 500,
        },
        {
          stage: 'preflop',
          seat: 3,
          userId: 'h3',
          action: 'bb',
          amount: 2,
          origin: 'forced',
          timestamp: t - 490,
        },
        {
          stage: 'preflop',
          seat: 4,
          userId: 'person-4',
          action: 'fold',
          amount: 0,
          origin: 'player',
          timestamp: t - 480,
        },
        {
          stage: 'preflop',
          seat: 5,
          userId: 'h5',
          action: 'call',
          amount: 2,
          origin: 'horse_policy',
          timestamp: t - 470,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: 'h1',
          action: 'raise',
          amount: 6,
          origin: 'horse_policy',
          isFullRaise: true,
          timestamp: t - 460,
        },
        {
          stage: 'preflop',
          seat: 5,
          userId: 'h5',
          action: 'call',
          amount: 4,
          origin: 'horse_policy',
          timestamp: t - 450,
        },
        {
          stage: 'flop',
          seat: 5,
          userId: 'h5',
          action: 'check',
          amount: 0,
          origin: 'horse_policy',
          timestamp: t - 400,
        },
        {
          stage: 'flop',
          seat: 1,
          userId: 'h1',
          action: 'check',
          amount: 0,
          origin: 'horse_policy',
          timestamp: t - 390,
        },
        {
          stage: 'turn',
          seat: 5,
          userId: 'h5',
          action: 'bet',
          amount: 10,
          origin: 'horse_policy',
          isFullRaise: true,
          timestamp: t - 300,
        },
        horseRaises
          ? {
              stage: 'turn',
              seat: 1,
              userId: 'h1',
              action: 'raise',
              amount: 30,
              origin: 'horse_policy',
              isFullRaise: true,
              timestamp: t - 290,
            }
          : {
              stage: 'turn',
              seat: 1,
              userId: 'h1',
              action: 'call',
              amount: 10,
              origin: 'horse_policy',
              timestamp: t - 290,
            },
        ...(horseRaises
          ? [
              {
                stage: 'turn',
                seat: 5,
                userId: 'h5',
                action: 'call',
                amount: 20,
                origin: 'horse_policy',
                timestamp: t - 285,
              },
            ]
          : []),
        {
          stage: 'river',
          seat: 5,
          userId: 'h5',
          action: 'bet',
          amount: 20,
          origin: 'horse_policy',
          isFullRaise: true,
          timestamp: t - 280,
        },
        {
          stage: 'river',
          seat: 1,
          userId: 'h1',
          action: 'fold',
          amount: 0,
          origin: 'horse_policy',
          timestamp: t - 270,
        },
      ],
    });
    const multiHistory: HistoryHand[] = [
      ...Array.from({ length: 520 }, (_, i) => horseRefHand(6000 + i, 400_000 + i * 1_000, i < 60)),
      // 34 Lightning hands: person-4 is passive on the turn (0 raises in 34 opps)
      ...Array.from({ length: 34 }, (_, i) =>
        postflopTurnHand(3000 + i, 1_000_000 + i * 1_000, 'person-4', 'h1', 'lightning', false)
      ),
      // 40 Classic table hands: person-4 raises 12 of 40 turns (30%, not a 100% maniac)
      ...Array.from({ length: 40 }, (_, i) =>
        postflopTurnHand(4000 + i, 1_100_000 + i * 1_000, 'person-4', 'h1', 'table', i < 12)
      ),
    ];
    const mem = new AsOfOpponentMemory(multiHistory);
    mem.learnThrough(2_000_000);

    // Sandbox style maps must be populated with distinct pooled vs Lightning-only aggression rows.
    const sm = mem.sandbox.styleMaps;
    expect(sm).toBeDefined();
    const key = 'nlh|cash|full|person-4';
    const aggPooled = sm!.styleAggression.get(key);
    const aggLightning = sm!.styleAggressionLightning.get(key);
    expect(aggPooled).toBeDefined();
    expect(aggLightning).toBeDefined();
    expect(aggPooled!.turn.raises).toBe(12);
    expect(aggPooled!.turn.raiseOpps).toBe(74);
    expect(aggLightning!.turn.raises).toBe(0);
    expect(aggLightning!.turn.raiseOpps).toBe(34);

    // Process-wide live style maps must stay completely untouched (zero static bleed).
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'pooled')).toBeNull();
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'lightning')).toBeNull();
    expect(
      HorseMind.runInSandbox(mem.sandbox, () =>
        HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'pooled')
      )
    ).not.toBeNull();
    expect(
      HorseMind.runInSandbox(mem.sandbox, () =>
        HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'lightning')
      )
    ).not.toBeNull();

    // A separate sandbox with ONLY Classic table history must stay isolated from `mem` and fire
    // style_lightning_separate_empty_seen when replaying a Lightning node with lightningStyleReadSeparate.
    const classicOnlyHistory: HistoryHand[] = Array.from({ length: 40 }, (_, i) =>
      postflopTurnHand(5000 + i, 1_000_000 + i * 1_000, 'person-4', 'h1', 'table', i < 12)
    );
    const classicMem = new AsOfOpponentMemory(classicOnlyHistory);
    classicMem.learnThrough(2_000_000);
    expect(
      HorseMind.runInSandbox(classicMem.sandbox, () =>
        HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'lightning')
      )
    ).toBeNull();
    expect(
      HorseMind.runInSandbox(classicMem.sandbox, () =>
        HorseMind.styleHorseReferenceOf('nlh', 'cash', 'full', 'pooled')
      )
    ).not.toBeNull();

    const prof = replayProfiles('cash').find((p) => p.live)!;
    const { hand: lHand, node: lNode } = turnCheckRaiseHand(lightningDomain);
    const lState = withSeatIds(stateAt(lHand, lNode), lHand);
    const emptyReplay = replayAtWithMemory(classicMem, lState, prof, [1, 7, 42], {
      styleRaiseRespect: true,
      lightningStyleReadSeparate: true,
    });
    expect(emptyReplay.receipts.style_lightning_separate_read_seen ?? 0).toBeGreaterThan(0);
    expect(emptyReplay.receipts.style_lightning_separate_empty_seen ?? 0).toBeGreaterThan(0);

    // Multi-domain replay must actually diverge on the style read when pooled (13/74 turn raises)
    // vs Lightning-only (1/34 turn raises) disagree: Lightning-only respects the rare turn check-raise.
    const multiPooled = replayAtWithMemory(mem, lState, prof, [1, 7, 42], {
      styleRaiseRespect: true,
    });
    const multiSeparate = replayAtWithMemory(mem, lState, prof, [1, 7, 42], {
      styleRaiseRespect: true,
      lightningStyleReadSeparate: true,
    });
    expect(multiSeparate.receipts.style_lightning_separate_read_seen ?? 0).toBeGreaterThan(0);
    expect(multiSeparate.receipts.style_lightning_separate_empty_seen ?? 0).toBe(0);
    expect(multiSeparate.receipts.style_raise_respect_seen ?? 0).toBeGreaterThan(
      multiPooled.receipts.style_raise_respect_seen ?? 0
    );
    expect(multiSeparate.actions).not.toEqual(multiPooled.actions);
  });
});
