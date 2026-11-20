import { describe, expect, it } from 'vitest';
import {
  HUD_BANDS,
  HUD_DEPTHS,
  HUD_LATE_WINDOW_MS,
  HUD_POSITIONS,
  HUD_STATS,
  HUD_TEXTURES,
  applyHudHand,
  emptyHudProfile,
  extractHandDeltas,
  handRecordFromRow,
  hudBand,
  hudHandClass,
  hudTexture,
  validHudProfile,
  type HudHandRecord,
  type OpponentHudProfile,
} from './OpponentHudProfile.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Act = [
  stage: 'preflop' | 'flop' | 'turn' | 'river',
  seat: number,
  action: string,
  amount: number,
];
interface Spec {
  id: number;
  at?: number;
  family?: 'plo4' | 'plo5';
  button: number;
  seats: [seat: number, user: number, stack?: number][];
  acts: Act[];
  board?: string[];
  showdown?: [user: number, mucked: boolean, name: string | null][];
  winners?: number[];
  bb?: number;
  extra?: Record<string, unknown>;
}

/** A hand_history-shaped row: players carry dealt cards on purpose (the builder must never read them). */
function row(s: Spec): Record<string, unknown> {
  return {
    id: H(s.id),
    created_at: new Date(s.at ?? 1_800_000_000_000 + s.id * 60_000).toISOString(),
    game_variant: s.family ?? 'plo5',
    tournament_id: null,
    big_blind: s.bb ?? 2,
    button_seat: s.button,
    players: s.seats.map(([seat, user, stack]) => ({
      seat,
      userId: U(user),
      username: `u${user}`,
      stack: stack ?? 400,
      cards: ['Zz', 'Zy', 'Zx', 'Zw', 'Zv'],
    })),
    actions: s.acts.map(([stage, seat, action, amount], i) => {
      const user = s.seats.find((x) => x[0] === seat)?.[1];
      return { seat, stage, action, amount, userId: user ? U(user) : null, timestamp: i };
    }),
    community_cards: s.board ?? [],
    showdown: (s.showdown ?? []).map(([user, mucked, name], i) => ({
      seat: s.seats.find((x) => x[1] === user)?.[0],
      user_id: U(user),
      mucked,
      hand_name: name,
      reveal_order: i,
    })),
    winners: (s.winners ?? []).map((u) => ({ userId: U(u), amount: 10 })),
    ...s.extra,
  };
}
function rec(s: Spec): HudHandRecord {
  const r = handRecordFromRow(row(s));
  if (typeof r === 'string') throw new Error(r);
  return r;
}
function profileAfter(
  user: number,
  specs: Spec[],
  family: 'plo4' | 'plo5' = 'plo5'
): OpponentHudProfile {
  const p = emptyHudProfile(U(user), family);
  for (const s of specs) applyHudHand(p, rec(s));
  return p;
}

// 6-max, button 6: SB 1, BB 2, EP 3, EP 4, CO 5, BTN 6. Pot after preflop 70.
const S1: Spec = {
  id: 1,
  button: 6,
  seats: [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
  ],
  acts: [
    ['preflop', 1, 'sb', 1],
    ['preflop', 2, 'bb', 2],
    ['preflop', 3, 'fold', 0],
    ['preflop', 4, 'raise', 7],
    ['preflop', 5, 'call', 7],
    ['preflop', 6, 'raise', 30],
    ['preflop', 1, 'fold', 0],
    ['preflop', 2, 'fold', 0],
    ['preflop', 4, 'fold', 0],
    ['preflop', 5, 'call', 23],
    ['flop', 5, 'check', 0],
    ['flop', 6, 'bet', 50],
    ['flop', 5, 'raise', 200],
    ['flop', 6, 'fold', 0],
  ],
  board: ['Ah', '7d', '2c'],
  winners: [5],
};

// Three-way limped pot to showdown: probe, barrel, river big bet shown strong / shown weak / mucked.
const S2: Spec = {
  id: 2,
  button: 3,
  seats: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  acts: [
    ['preflop', 1, 'sb', 1],
    ['preflop', 2, 'bb', 2],
    ['preflop', 3, 'call', 2],
    ['preflop', 1, 'call', 1],
    ['preflop', 2, 'check', 0],
    ['flop', 1, 'check', 0],
    ['flop', 2, 'check', 0],
    ['flop', 3, 'check', 0],
    ['turn', 1, 'bet', 2],
    ['turn', 2, 'call', 2],
    ['turn', 3, 'call', 2],
    ['river', 1, 'bet', 12],
    ['river', 2, 'call', 12],
    ['river', 3, 'fold', 0],
  ],
  board: ['9h', '8h', '7h', 'Kd', '2s'],
  showdown: [
    [1, false, 'Straight'],
    [2, true, null],
  ],
  winners: [1],
};

describe('OpponentHudProfile: hand-constructed histories', () => {
  it('preflop: open, limp, 3-bet, 4-bet, fold to 3-bet, cold call, VPIP/PFR by position', () => {
    const e = profileAfter(5, [S1]).life;
    expect(e['pf.vpip']).toEqual([1, 1]);
    expect(e['pf.pfr']).toEqual([1, 0]);
    expect(e['pf.cc']).toEqual([1, 1]);
    expect(e['pf.4bet']).toEqual([1, 0]);
    expect(e['pf.vpip@CO']).toEqual([1, 1]);
    const f = profileAfter(6, [S1]).life;
    expect(f['pf.3bet']).toEqual([1, 1]);
    expect(f['pf.pfr@BTN']).toEqual([1, 1]);
    const d = profileAfter(4, [S1]).life;
    expect(d['pf.open']).toEqual([1, 1]);
    expect(d['pf.limp']).toEqual([1, 0]);
    expect(d['pf.f3bet']).toEqual([1, 1]);
    expect(d['pf.vpip@EP']).toEqual([1, 1]);
    const a = profileAfter(1, [S1]).life;
    expect(a['pf.vpip']).toEqual([1, 0]);
    expect(a['pf.vpip@SB']).toEqual([1, 0]);
    expect(a['pf.4bet']).toEqual([1, 0]);
    const c = profileAfter(3, [S2]).life;
    expect(c['pf.limp']).toEqual([1, 1]);
    expect(c['pf.open']).toEqual([1, 0]);
  });

  it('a big-blind walk gives no preflop opportunity', () => {
    const walk: Spec = {
      id: 3,
      button: 3,
      seats: [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 3, 'fold', 0],
        ['preflop', 1, 'fold', 0],
      ],
      winners: [2],
    };
    const bb = profileAfter(2, [walk]);
    expect(bb.life['pf.vpip']).toBeUndefined();
    expect(bb.hands).toBe(1);
  });

  it('postflop: c-bet, donk opportunity, check-raise, fold to raise, size bands, texture', () => {
    const e = profileAfter(5, [S1]).life;
    expect(e['f.betCk']).toEqual([1, 0]);
    expect(e['f.donk']).toEqual([1, 0]);
    expect(e['f.fBet']).toEqual([1, 0]);
    expect(e['f.cBet']).toEqual([1, 0]);
    expect(e['f.rBet']).toEqual([1, 1]);
    expect(e['f.rBet.m']).toEqual([1, 1]); // faced 50 into 70 = 0.71
    expect(e['f.fBet.dry']).toEqual([1, 0]);
    expect(e['f.xr']).toEqual([1, 1]);
    expect(e['f.bsz.l']).toEqual([1, 1]); // raise 150 more into 170 = 0.88
    expect(e['f.bsz.s']).toEqual([1, 0]);
    const f = profileAfter(6, [S1]).life;
    expect(f['f.cbet']).toEqual([1, 1]);
    expect(f['f.betCk.dry']).toEqual([1, 1]);
    expect(f['f.fRaise']).toEqual([1, 1]);
    expect(f['f.bsz.m']).toEqual([1, 1]);
  });

  it('turn probe and barrel, river bet sizes, showdown went/won and revealed strength of big bets', () => {
    const a = profileAfter(1, [S2]).life;
    expect(a['t.probe']).toEqual([1, 1]);
    expect(a['t.betCk']).toEqual([1, 1]);
    expect(a['r.barrel']).toEqual([1, 1]);
    expect(a['r.bsz.l']).toEqual([1, 1]); // 12 into 12
    expect(a['sd.wtsd']).toEqual([1, 1]);
    expect(a['sd.wsd']).toEqual([1, 1]);
    expect(a['sd.strong.r']).toEqual([1, 1]);
    expect(a['sd.strongBig.r']).toEqual([1, 1]);
    expect(a['sd.strong.t']).toEqual([1, 1]);
    const b = profileAfter(2, [S2]).life;
    expect(b['t.cBet.s']).toEqual([1, 1]); // 2 into 6
    expect(b['r.cBet.l']).toEqual([1, 1]);
    expect(b['sd.wtsd']).toEqual([1, 1]);
    expect(b['sd.wsd']).toEqual([1, 0]);
    // mucked at showdown: nothing revealed
    expect(b['sd.strong.r']).toBeUndefined();
    const c = profileAfter(3, [S2]).life;
    expect(c['r.fBet.l']).toEqual([1, 1]);
    expect(c['sd.wtsd']).toEqual([1, 0]);
  });

  it('recall: instances by spot with what he did and what he showed', () => {
    const a = profileAfter(1, [S2]);
    expect(a.recall['river|xA']).toEqual([1, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(a.recall['turn|x0']).toEqual([1, 0, 0, 0, 0, 1, 1, 1, 1]);
    const b = profileAfter(2, [S2]);
    expect(b.recall['river|b1|l']).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(b.last.length).toBeGreaterThan(0);
    expect(b.last.every((i) => i.sh === 0)).toBe(true);
  });

  it('a hand is counted exactly once (replay, retry, out of order inside the late window)', () => {
    const p = emptyHudProfile(U(5), 'plo5');
    expect(applyHudHand(p, rec(S1))).toBeNull();
    const snap = JSON.stringify(p);
    expect(applyHudHand(p, rec(S1))).toBe('duplicate');
    expect(JSON.stringify(p)).toBe(snap);
    const later = {
      ...S2,
      id: 9,
      at: 1_800_000_000_000 + 100 * 60_000,
      seats: S2.seats.map((s) => [s[0], s[1] === 1 ? 5 : s[1]] as [number, number]),
    };
    expect(applyHudHand(p, rec(later))).toBeNull();
    const early = { ...S1, id: 10, at: 1_800_000_000_000 + 100 * 60_000 - 60_000 };
    expect(applyHudHand(p, rec(early))).toBeNull();
    const stale = { ...S1, id: 11, at: 1_800_000_000_000 + 100 * 60_000 - HUD_LATE_WINDOW_MS - 1 };
    expect(applyHudHand(p, rec(stale))).toBe('stale');
    expect(p.hands).toBe(3);
  });

  it('recency layer decays, lifetime layer never does', () => {
    const p = emptyHudProfile(U(5), 'plo5');
    applyHudHand(p, rec({ ...S1, id: 20, at: 1_800_000_000_000 }));
    applyHudHand(p, rec({ ...S1, id: 21, at: 1_800_000_000_000 + 7 * 24 * 3600 * 1000 }));
    expect(p.life['pf.vpip']).toEqual([2, 2]);
    expect(p.rec['pf.vpip'][0]).toBeCloseTo(1.5, 6);
  });

  it('bomb pots, double boards, tournaments and other games are refused', () => {
    expect(handRecordFromRow(row({ ...S1, extra: { bomb_pot: { on: true } } }))).toBe('bomb_pot');
    expect(handRecordFromRow(row({ ...S1, extra: { community_cards2: ['Ah'] } }))).toBe(
      'multi_board'
    );
    expect(handRecordFromRow(row({ ...S1, extra: { tournament_id: H(99) } }))).toBe('tournament');
    expect(handRecordFromRow(row({ ...S1, extra: { game_variant: 'plo6' } }))).toBe('not_plo45');
  });

  it('all-in raise and multiway: the all-in amount is the street total and counts as a raise', () => {
    const s: Spec = {
      id: 30,
      button: 3,
      seats: [
        [1, 1, 50],
        [2, 2],
        [3, 3],
      ],
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 3, 'raise', 7],
        ['preflop', 1, 'all_in', 50],
        ['preflop', 2, 'call', 48],
        ['preflop', 3, 'call', 43],
      ],
      board: ['Ah', 'Kh', '2h', '3d', '4c'],
      showdown: [
        [1, false, 'Flush'],
        [2, false, 'Two Pair'],
        [3, false, 'Straight'],
      ],
      winners: [1],
    };
    const a = profileAfter(1, [s]).life;
    expect(a['pf.3bet']).toEqual([1, 1]);
    expect(a['pf.pfr']).toEqual([1, 1]);
    expect(a['sd.wsd']).toEqual([1, 1]);
    const c = profileAfter(3, [s]).life;
    expect(c['pf.f3bet']).toEqual([1, 0]);
  });

  it('helpers: bands, textures, hand classes', () => {
    expect(hudBand(0.33)).toBe('s');
    expect(hudBand(0.5)).toBe('m');
    expect(hudBand(1)).toBe('l');
    expect(hudBand(1.5)).toBe('o');
    expect(hudTexture(['Ah', 'Kh', '2h'])).toBe('mono');
    expect(hudTexture(['Ah', 'Ad', '2c'])).toBe('paired');
    expect(hudTexture(['9h', '8d', '7c'])).toBe('conn');
    expect(hudTexture(['Ah', '7d', '2c'])).toBe('dry');
    expect(hudTexture(['Ahearts', '2diamonds', '3clubs'])).toBe('conn');
    expect(hudHandClass('Straight')).toBe(4);
    expect(hudHandClass('Two Pair')).toBe(2);
    expect(hudHandClass('Straight Flush')).toBe(8);
  });

  it('a stored profile of another version or with an unknown statistic is invalid', () => {
    const p = profileAfter(5, [S1]);
    expect(validHudProfile(p)).toBe(true);
    expect(validHudProfile({ ...p, v: 2 })).toBe(false);
    expect(validHudProfile({ ...p, life: { ...p.life, 'pf.secret': [1, 1] } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Registry law: every registered statistic has an opportunity in a constructed history, so a new statistic cannot be
// added without a history that exercises it (add a scenario here when this fails).
// ---------------------------------------------------------------------------------------------------------------

function generatedHistories(): Spec[] {
  const out: Spec[] = [S1, S2];
  let id = 100;
  const boards: Record<string, string[]> = {
    mono: ['Ah', 'Kh', '2h', '3d', '4c'],
    paired: ['Ah', 'Ad', '2c', '3d', '9c'],
    conn: ['9h', '8d', '7c', '2d', '3c'],
    dry: ['Ah', '7d', '2c', 'Kd', '9s'],
  };
  // facing bets of every band on every street, with a check-raise, a fold to raise, a donk and a showdown
  const sizes: Record<string, number> = { s: 0.25, m: 0.6, l: 1, o: 1.5 };
  for (const tex of HUD_TEXTURES)
    for (const b of HUD_BANDS) {
      const pf = 20; // pot after preflop (10 each)
      const bet = (pot: number) => Math.round(pot * sizes[b] * 100) / 100;
      const fb = bet(pf);
      const fPot = pf + 2 * fb;
      const tb = bet(fPot);
      const tPot = fPot + 2 * tb;
      const rb = bet(tPot);
      out.push({
        id: id++,
        button: 2,
        seats: [
          [1, 1, 1000],
          [2, 2, 1000],
        ],
        acts: [
          ['preflop', 2, 'sb', 1],
          ['preflop', 1, 'bb', 2],
          ['preflop', 2, 'raise', 10],
          ['preflop', 1, 'call', 8],
          ['flop', 1, 'check', 0],
          ['flop', 2, 'bet', fb],
          ['flop', 1, 'call', fb],
          ['turn', 1, 'check', 0],
          ['turn', 2, 'bet', tb],
          ['turn', 1, 'call', tb],
          ['river', 1, 'check', 0],
          ['river', 2, 'bet', rb],
          ['river', 1, 'call', rb],
        ],
        board: boards[tex],
        showdown: [
          [2, false, 'Full House'],
          [1, false, 'Pair'],
        ],
        winners: [2],
      });
      // donk, check-raise, raise of a bet, fold to raise and probes on every street
      out.push({
        id: id++,
        button: 3,
        seats: [
          [1, 1, 1000],
          [2, 2, 1000],
          [3, 3, 1000],
        ],
        acts: [
          ['preflop', 1, 'sb', 1],
          ['preflop', 2, 'bb', 2],
          ['preflop', 3, 'raise', 7],
          ['preflop', 1, 'call', 6],
          ['preflop', 2, 'call', 5],
          ['flop', 1, 'bet', bet(21)],
          ['flop', 2, 'fold', 0],
          ['flop', 3, 'raise', bet(21) * 4],
          ['flop', 1, 'fold', 0],
        ],
        board: boards[tex],
        winners: [3],
      });
      for (const st of ['turn', 'river'] as const) {
        const acts: Act[] = [
          ['preflop', 1, 'sb', 1],
          ['preflop', 2, 'bb', 2],
          ['preflop', 3, 'raise', 7],
          ['preflop', 1, 'call', 6],
          ['preflop', 2, 'call', 5],
          ['flop', 1, 'check', 0],
          ['flop', 2, 'check', 0],
          ['flop', 3, 'check', 0],
        ];
        if (st === 'river')
          acts.push(['turn', 1, 'check', 0], ['turn', 2, 'check', 0], ['turn', 3, 'check', 0]);
        acts.push(
          [st, 1, 'check', 0],
          [st, 2, 'bet', bet(21)],
          [st, 3, 'call', bet(21)],
          [st, 1, 'raise', bet(21) * 5],
          [st, 2, 'fold', 0],
          [st, 3, 'fold', 0]
        );
        out.push({
          id: id++,
          button: 3,
          seats: [
            [1, 1, 1000],
            [2, 2, 1000],
            [3, 3, 1000],
          ],
          acts,
          board: boards[tex],
          winners: [1],
        });
        const acts2: Act[] = acts.slice(0, acts.length - 6);
        acts2.push(
          [st, 1, 'bet', bet(21)],
          [st, 2, 'raise', bet(21) * 4],
          [st, 3, 'fold', 0],
          [st, 1, 'fold', 0]
        );
        out.push({
          id: id++,
          button: 3,
          seats: [
            [1, 1, 1000],
            [2, 2, 1000],
            [3, 3, 1000],
          ],
          acts: acts2,
          board: boards[tex],
          winners: [2],
        });
      }
    }
  // every position and depth band
  for (const [stack, n] of [
    [40, 6],
    [200, 6],
    [600, 6],
  ] as const) {
    const seats: [number, number, number][] = [];
    for (let s = 1; s <= n; s++) seats.push([s, s, stack]);
    out.push({
      id: id++,
      button: 6,
      seats,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 3, 'call', 2],
        ['preflop', 4, 'raise', 7],
        ['preflop', 5, 'raise', 24],
        ['preflop', 6, 'raise', 80],
        ['preflop', 1, 'fold', 0],
        ['preflop', 2, 'fold', 0],
        ['preflop', 3, 'fold', 0],
        ['preflop', 4, 'fold', 0],
        ['preflop', 5, 'fold', 0],
      ],
      winners: [6],
    });
  }
  return out.map((s) => ({
    ...s,
    // a public node on every action, so the depth bands are known
    extra: { ...(s.extra ?? {}) },
  }));
}

describe('registry law', () => {
  it('every registered statistic has an opportunity in the constructed histories', () => {
    const seen = new Set<string>();
    for (const s of generatedHistories()) {
      const r = rec(s);
      for (const d of extractHandDeltas(r)) for (const k of d.stats.keys()) seen.add(k);
      for (const u of s.seats) {
        const p = emptyHudProfile(U(u[1]), 'plo5');
        applyHudHand(p, r);
        for (const k of Object.keys(p.life)) seen.add(k);
      }
    }
    // depth bands need the public node (stack before the action); they are covered by the node test below
    const missing = HUD_STATS.filter(
      (s) => !seen.has(s) && !HUD_DEPTHS.some((d) => s.endsWith(`@${d}`))
    );
    expect(missing).toEqual([]);
    for (const p of HUD_POSITIONS) expect(seen.has(`pf.vpip@${p}`)).toBe(true);
  });

  it('depth bands come from the public node stack', () => {
    for (const [stack, band] of [
      [100, 'd1'],
      [200, 'd2'],
      [400, 'd3'],
    ] as const) {
      const r = row({
        id: 500 + stack,
        button: 2,
        seats: [
          [1, 1, stack],
          [2, 2, stack],
        ],
        acts: [
          ['preflop', 2, 'sb', 1],
          ['preflop', 1, 'bb', 2],
          ['preflop', 2, 'raise', 6],
          ['preflop', 1, 'fold', 0],
        ],
      });
      (r.actions as Record<string, unknown>[])[2].publicNode = {
        pot: 3,
        toCall: 1,
        currentBet: 2,
        seats: [
          [1, stack - 2, 2, 2, 0, 0, 0],
          [2, stack - 1, 1, 1, 0, 0, 0],
        ],
      };
      (r.actions as Record<string, unknown>[])[3].publicNode = {
        pot: 8,
        toCall: 4,
        currentBet: 6,
        seats: [
          [1, stack - 2, 2, 2, 0, 0, 0],
          [2, stack - 6, 6, 6, 0, 0, 0],
        ],
      };
      const h = handRecordFromRow(r) as HudHandRecord;
      const p = emptyHudProfile(U(2), 'plo5');
      applyHudHand(p, h);
      expect(p.life[`pf.vpip@${band}`]).toEqual([1, 1]);
      expect(p.life[`pf.pfr@${band}`]).toEqual([1, 1]);
    }
  });
});
