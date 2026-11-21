/**
 * LAW (2026-11-21, lead order 8 PM; lane OPPONENT-HUD): the MATHCORE-2 opponent layer and STAB-DEFENCE read their
 * per-opponent counts through the ONE accessor (hudStat / hudStatIn), from public history only, shrunk by n / (n + k)
 * with no sample cliff; the offline as-of builder returns the same counts (countsBefore).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyHudHand,
  emptyHudProfile,
  extractHandDeltas,
  handRecordFromRow,
  HUD_SESSION_DECAY,
  HUD_SESSION_GAP_MS,
  HUD_SESSION_STATS,
  HUD_STATS,
  type HudHandRecord,
} from './OpponentHudProfile.js';
import {
  buildHudPacket,
  clearDecisionHud,
  hudContextStatId,
  hudFirstWagerRecord,
  hudLifetimeCount,
  hudSessionRecord,
  hudStat,
  hudStatIn,
  installDecisionHud,
} from './OpponentHud.js';
import { OpponentHudAsOf } from './OpponentHudAsOf.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_800_000_000_000;
type A = [stage: string, seat: number, action: string, amount: number];
function raw(id: number, seats: number, acts: A[], shown: [number, string][] = []) {
  return {
    id: H(id),
    created_at: new Date(T0 + id * 1000).toISOString(),
    game_variant: 'plo5',
    tournament_id: null,
    big_blind: 2,
    button_seat: seats === 2 ? 2 : 3,
    players: Array.from({ length: seats }, (_, i) => ({
      seat: i + 1,
      userId: U(i + 1),
      stack: 1000,
    })),
    actions: acts.map(([stage, seat, action, amount]) => ({
      seat,
      userId: U(seat),
      stage,
      action,
      amount,
    })),
    community_cards: ['Ah', '7d', '2c', 'Kd', '9s'],
    showdown: shown.map(([seat, name], i) => ({
      seat,
      user_id: U(seat),
      mucked: false,
      hand_name: name,
      reveal_order: i,
    })),
    winners: shown.length
      ? [{ userId: U(shown[0][0]), amount: 10 }]
      : [{ userId: U(2), amount: 10 }],
  };
}
const hu = (id: number, flop: A[], shown: [number, string][] = []) =>
  raw(
    id,
    2,
    [
      ['preflop', 2, 'sb', 1],
      ['preflop', 1, 'bb', 2],
      ['preflop', 2, 'call', 1],
      ['preflop', 1, 'check', 0],
      ...flop,
    ],
    shown
  );
const life = (rows: unknown[], user: number) => {
  const p = emptyHudProfile(U(user), 'plo5');
  for (const r of rows) applyHudHand(p, handRecordFromRow(r) as HudHandRecord);
  return p;
};

describe('context reads: MATHCORE-2 fold to the first wager, STAB-DEFENCE stab and value share', () => {
  it('fold to the first wager by size (<= 0.7 pot small, > 0.7 big) and players; stab when checked to', () => {
    const small = hu(1, [
      ['flop', 1, 'check', 0],
      ['flop', 2, 'bet', 2],
      ['flop', 1, 'fold', 0],
    ]); // 2 into 4
    const big = hu(2, [
      ['flop', 1, 'check', 0],
      ['flop', 2, 'bet', 4],
      ['flop', 1, 'call', 4],
    ]); // pot-size
    const lead = hu(3, [
      ['flop', 1, 'bet', 4],
      ['flop', 2, 'fold', 0],
    ]); // first to act: a lead, not a stab
    const p1 = life([small, big, lead], 1);
    const p2 = life([small, big, lead], 2);
    expect(p1.life['f.fb.sm.hu']).toEqual([1, 1]);
    expect(p1.life['f.fb.bg.hu']).toEqual([1, 0]);
    expect(p2.life['f.fb.bg.hu']).toEqual([1, 1]);
    expect(p2.life['f.stab.hu']).toEqual([2, 2]);
    expect(p1.life['f.stab.hu']).toBeUndefined();
    // first wagers on unopened action, split checked-to (stab) vs first to act (lead): seat 1 led once of 3 chances
    expect(p1.life['f.lead.hu']).toEqual([3, 1]);
    expect(p2.life['f.lead.hu']).toBeUndefined();
    // the packet carries the RAW lifetime pair; hudLifetimeCount returns it unshrunk, without decay
    installDecisionHud(buildHudPacket('plo5', [p1, p2], {}, T0 + 400 * 86_400_000, 'flop'));
    expect(hudLifetimeCount(U(1), 'plo5', 'x.lead', { street: 'flop', players: 'hu' })).toEqual({
      n: 3,
      hits: 1,
      stat: 'f.lead.hu',
    });
    expect(
      hudLifetimeCount(U(2), 'plo5', 'x.stab', { street: 'flop', players: 'hu' })
    ).toMatchObject({ n: 2, hits: 2 });
    expect(
      hudLifetimeCount(U(7), 'plo5', 'x.stab', { street: 'flop', players: 'hu' })
    ).toMatchObject({ n: 0, hits: 0 });
    expect(hudFirstWagerRecord(U(1), 'plo5', 'flop', 'hu')).toEqual({
      bets: 1,
      opps: 3,
      checkedTo: { bets: 0, opps: 0, sizeSum: 0 },
      firstToAct: { bets: 1, opps: 3 },
    });
    // seat 2 stabbed 2 into 4 (0.5 pot) and 4 into 4 (1 pot): sizeSum 1.5
    expect(hudFirstWagerRecord(U(2), 'plo5', 'flop', 'hu')).toMatchObject({
      bets: 2,
      opps: 2,
      checkedTo: { bets: 2, opps: 2, sizeSum: 1.5 },
    });
    expect(hudFirstWagerRecord(U(7), 'plo5', 'flop', 'hu')).toBeNull();
    clearDecisionHud();
    // three-way: multiway cells
    const mw = raw(4, 3, [
      ['preflop', 1, 'sb', 1],
      ['preflop', 2, 'bb', 2],
      ['preflop', 3, 'call', 2],
      ['preflop', 1, 'call', 1],
      ['preflop', 2, 'check', 0],
      ['flop', 1, 'check', 0],
      ['flop', 2, 'check', 0],
      ['flop', 3, 'bet', 3],
      ['flop', 1, 'fold', 0],
      ['flop', 2, 'fold', 0],
    ]);
    expect(life([mw], 1).life['f.fb.sm.mw']).toEqual([1, 1]);
    expect(life([mw], 3).life['f.stab.mw']).toEqual([1, 1]);
  });

  it('value share of his wagers by line and size counts shown hands only', () => {
    const shownStrong = hu(
      5,
      [
        ['flop', 1, 'check', 0],
        ['flop', 2, 'bet', 4],
        ['flop', 1, 'call', 4],
      ],
      [
        [2, 'Full House'],
        [1, 'Pair'],
      ]
    );
    const mucked = hu(6, [
      ['flop', 1, 'check', 0],
      ['flop', 2, 'bet', 4],
      ['flop', 1, 'call', 4],
    ]);
    const p2 = life([shownStrong, mucked], 2);
    expect(p2.life['vs.f.stab.bg']).toEqual([1, 1]);
    expect(p2.life['f.stab.hu']).toEqual([2, 2]);
  });

  it('one accessor: hudStatIn resolves to a registered statistic and shrinks by n / (n + k), no cliff', () => {
    for (const [alias, ctx, id] of [
      ['x.foldToBet.small', { street: 'flop', players: 'hu' }, 'f.fb.sm.hu'],
      ['x.foldToBet.big', { street: 'river', players: 'mw' }, 'r.fb.bg.mw'],
      ['x.stab', { street: 'turn', players: 'hu' }, 't.stab.hu'],
      ['x.valueShare', { street: 'flop', line: 'raise', size: 'big' }, 'vs.f.raise.bg'],
    ] as const) {
      expect(hudContextStatId(alias, ctx)).toBe(id);
      expect(HUD_STATS).toContain(id);
    }
    expect(hudContextStatId('x.stab', { street: 'flop' })).toBeNull();
    const rows = Array.from({ length: 40 }, (_, i) =>
      hu(100 + i, [
        ['flop', 1, 'check', 0],
        ['flop', 2, 'bet', 2],
        ['flop', 1, 'fold', 0],
      ])
    );
    let prevP = -1;
    let prevW = 0;
    for (const n of [0, 1, 2, 5, 10, 20, 40]) {
      const p = life(rows.slice(0, n), 1);
      installDecisionHud(
        buildHudPacket('plo5', [p], { 'f.fb.sm.hu': [0.3, 20] }, T0 + 1e9, 'flop')
      );
      const r = hudStatIn(
        U(1),
        'plo5',
        'x.foldToBet.small',
        { street: 'flop', players: 'hu' },
        null,
        false
      );
      expect(r).toEqual(hudStat(U(1), 'plo5', 'f.fb.sm.hu', null, false));
      // the packet carries the blended lifetime/recency count (OpponentHud.blendedCount); the read is its shrinkage
      if (n === 0) expect(r.n).toBe(0);
      else expect(r.n).toBeGreaterThan(0);
      expect(r.weight).toBeCloseTo(r.n / (r.n + 20), 6);
      expect(r.p!).toBeCloseTo((r.hits + 20 * 0.3) / (r.n + 20), 6);
      expect(r.p!).toBeGreaterThan(prevP); // every hand moves the read: no threshold, no cliff
      expect(r.weight).toBeGreaterThanOrEqual(prevW);
      prevP = r.p!;
      prevW = r.weight;
    }
    // an unknown context reads as no evidence: the prior
    const none = hudStatIn(U(1), 'plo5', 'x.stab', { street: 'flop' }, 0.4, false);
    expect(none).toMatchObject({ n: 0, p: 0.4, source: 'prior' });
    clearDecisionHud();
  });

  it('the offline as-of builder returns the same lifetime counts, strictly before the hand', () => {
    const rows = [
      hu(200, [
        ['flop', 1, 'check', 0],
        ['flop', 2, 'bet', 2],
        ['flop', 1, 'fold', 0],
      ]),
      hu(201, [
        ['flop', 1, 'check', 0],
        ['flop', 2, 'bet', 4],
        ['flop', 1, 'fold', 0],
      ]),
      hu(202, [
        ['flop', 1, 'check', 0],
        ['flop', 2, 'bet', 2],
        ['flop', 1, 'call', 2],
      ]),
    ];
    const b = new OpponentHudAsOf(rows);
    const c = b.countsBefore(
      H(202),
      'plo5',
      [U(1), U(2)],
      ['f.fb.sm.hu', 'f.fb.bg.hu', 'f.stab.hu']
    );
    expect(c![U(1)]).toEqual({ 'f.fb.sm.hu': [1, 1], 'f.fb.bg.hu': [1, 1], 'f.stab.hu': [0, 0] });
    expect(c![U(2)]['f.stab.hu']).toEqual([2, 2]);
    expect(b.countsBefore(H(999), 'plo5', [U(1)], ['f.fb.sm.hu'])).toBeNull();
    // never a hole card: the record keeps seat, user and stack only
    const withCards = {
      ...rows[0],
      players: rows[0].players.map((p) => ({ ...p, cards: ['Qx', 'Qy'] })),
    };
    const rec = handRecordFromRow(withCards) as HudHandRecord;
    expect(JSON.stringify(rec)).not.toContain('Qx');
    expect(extractHandDeltas(rec).length).toBe(2);
  });
});

/**
 * SESSION SUMS IN THE PACKET (2026-11-21, lane OPPONENT-HUD-4): the store carries what the FADE cold-start estimator
 * needs; nothing reads it for a decision. Additive: every existing read answers exactly as without it.
 */
describe('session sums of responses to a first wager (store only, additive)', () => {
  // seat 1 answers seat 2's flop bet: fold (1) or call (0); the hand's time is T0 + id seconds
  const resp = (id: number, fold: 0 | 1, bet = 2) =>
    hu(id, [
      ['flop', 1, 'check', 0],
      ['flop', 2, 'bet', bet],
      ['flop', 1, fold ? 'fold' : 'call', fold ? 0 : bet],
    ]);
  const ys: (0 | 1)[] = [1, 0, 0, 1, 1, 0, 1];

  it("the sums are the measurement's recurrence: decay per response, raw session counts, one sequence over sizes", () => {
    const p = emptyHudProfile(U(1), 'plo5');
    let sW = 0;
    let sSw = 0;
    ys.forEach((y, i) => {
      applyHudHand(p, handRecordFromRow(resp(10 + i, y, i % 2 ? 4 : 2)) as HudHandRecord);
      sSw = sSw * HUD_SESSION_DECAY + y;
      sW = sW * HUD_SESSION_DECAY + 1;
    });
    expect(HUD_SESSION_STATS.length).toBe(12);
    expect(HUD_SESSION_DECAY).toBeCloseTo(0.5 ** (1 / 30), 12);
    expect(p.ses).toMatchObject({ at: T0 + 16_000, m: 7, n: 7, f: 4 });
    expect(p.ses!.sW).toBeCloseTo(sW, 12);
    expect(p.ses!.sSw).toBeCloseTo(sSw, 12);
    expect(p.ses!.st).toEqual({ 'f.fb.sm.hu': [4, 3], 'f.fb.bg.hu': [3, 1] });
    // the bettor made no response to a first wager: no session layer for him
    const bettor = life(
      ys.map((y, i) => resp(10 + i, y)),
      2
    );
    expect(bettor.ses).toBeUndefined();
    // a retry changes nothing
    const snap = JSON.stringify(p.ses);
    expect(applyHudHand(p, handRecordFromRow(resp(12, 0)) as HudHandRecord)).toBe('duplicate');
    expect(JSON.stringify(p.ses)).toBe(snap);
    // an older hand applied out of order counts for the lifetime only
    expect(applyHudHand(p, handRecordFromRow(resp(5, 1)) as HudHandRecord)).toBeNull();
    expect(JSON.stringify(p.ses)).toBe(snap);
    expect(p.life['f.fb.sm.hu'][0] + p.life['f.fb.bg.hu'][0]).toBe(8);
    // more than an hour after his last response: a new session
    const gapId = 16 + HUD_SESSION_GAP_MS / 1000 + 1;
    applyHudHand(p, handRecordFromRow(resp(gapId, 1)) as HudHandRecord);
    expect(p.ses).toEqual({
      at: T0 + gapId * 1000,
      m: 1,
      sW: 1,
      sSw: 1,
      n: 1,
      f: 1,
      st: { 'f.fb.sm.hu': [1, 1] },
    });
  });

  it('the packet carries them; the session record splits the lifetime into this session and the sessions before', () => {
    const rows = [resp(1, 1), resp(2, 1), ...ys.map((y, i) => resp(4000 + i, y))];
    const p = life(rows, 1);
    const at = T0 + 4_010_000;
    installDecisionHud(buildHudPacket('plo5', [p], {}, at, 'flop'));
    const live = hudSessionRecord(U(1), 'plo5', at)!;
    expect(live).toMatchObject({
      m: 7,
      session: { n: 7, f: 4 },
      prior: { n: 2, f: 2 },
      live: true,
    });
    expect(live.sW).toBeCloseTo(p.ses!.sW, 5);
    // an hour after his last response the session is over: his whole lifetime is the prior
    expect(hudSessionRecord(U(1), 'plo5', at + HUD_SESSION_GAP_MS)).toEqual({
      m: 0,
      sW: 0,
      sSw: 0,
      session: { n: 0, f: 0 },
      prior: { n: 9, f: 6 },
      live: false,
    });
    expect(hudSessionRecord(U(7), 'plo5', at)).toBeNull();
    clearDecisionHud();
    expect(hudSessionRecord(U(1), 'plo5', at)).toBeNull();
  });

  it('additive: with or without the session sums every existing read answers the same', () => {
    const p = life([resp(1, 1), resp(2, 0), resp(3, 1)], 1);
    const at = T0 + 60_000;
    const withSs = buildHudPacket('plo5', [p], {}, at, 'flop');
    expect(withSs.opp[U(1)].ss).toBeDefined();
    const without = JSON.parse(JSON.stringify(withSs));
    delete without.opp[U(1)].ss;
    const reads = () =>
      JSON.stringify([
        HUD_STATS.map((stat) => hudStat(U(1), 'plo5', stat, undefined, false)),
        hudStatIn(U(1), 'plo5', 'x.foldToBet.small', { street: 'flop', players: 'hu' }, 0.5, false),
        hudLifetimeCount(U(1), 'plo5', 'x.lead', { street: 'flop', players: 'hu' }),
        hudFirstWagerRecord(U(1), 'plo5', 'flop', 'hu'),
      ]);
    installDecisionHud(withSs);
    const a = reads();
    installDecisionHud(without);
    expect(reads()).toBe(a);
    clearDecisionHud();
    // a malformed session field makes the packet invalid (nothing installed), never a throw
    const bad = JSON.parse(JSON.stringify(withSs));
    bad.opp[U(1)].ss = { at: 'x' };
    installDecisionHud(bad);
    expect(hudStat(U(1), 'plo5', 'f.fb.sm.hu', undefined, false).source).not.toBe('lifetime');
    clearDecisionHud();
    // no decision source reads the session sums yet: only the provider files name them
    const src = readFileSync(fileURLToPath(new URL('./OpponentHud.ts', import.meta.url)), 'utf8');
    const reader = src.slice(
      src.indexOf('export function hudStat('),
      src.indexOf('export function hudSessionRecord(')
    );
    expect(reader).not.toMatch(/\.ss\b/);
  });
});
