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
