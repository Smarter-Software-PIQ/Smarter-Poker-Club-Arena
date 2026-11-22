import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HUD_BANDS,
  HUD_CONTEXT_STATS,
  HUD_DAYS_KEPT,
  HUD_DAY_ENTRY_BYTES,
  HUD_DEPTHS,
  HUD_LATE_WINDOW_MS,
  HUD_POSITIONS,
  HUD_PROFILE_FIXED_MAX_BYTES,
  HUD_STATS,
  HUD_TEXTURES,
  applyHudHand,
  emptyHudProfile,
  extractHandDeltas,
  handRecordFromRow,
  hudBand,
  hudHandClass,
  hudTexture,
  hudDayOf,
  hudHandDigest,
  hudIdPrefix,
  hudDayListHands,
  hudProfileBytesBound,
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
    // older than the late window: the day list proves it was never counted, so it is counted now, once
    const old = { ...S1, id: 11, at: 1_800_000_000_000 + 100 * 60_000 - HUD_LATE_WINDOW_MS - 1 };
    expect(applyHudHand(p, rec(old))).toBeNull();
    expect(applyHudHand(p, rec(old))).toBe('duplicate');
    expect(p.hands).toBe(4);
    // a row written before the day lists existed cannot prove it: the watermark rule refuses the old hand
    const legacy = emptyHudProfile(U(5), 'plo5');
    applyHudHand(legacy, rec(later));
    delete legacy.days;
    delete legacy.daysSince;
    expect(applyHudHand(legacy, rec({ ...old, id: 12 }))).toBe('stale');
    expect(legacy.hands).toBe(1);
  });

  it('the hand id is the idempotency key for every listed day: any order, any retry, past the id ring', () => {
    const t = 1_800_000_000_000;
    const specs = Array.from({ length: 200 }, (_, i) => ({
      ...S1,
      id: 1000 + i,
      at: t + i * 20_000,
    }));
    const inOrder = emptyHudProfile(U(5), 'plo5');
    for (const x of specs) expect(applyHudHand(inOrder, rec(x))).toBeNull();
    // the same hands newest first, each delivered twice (a catch-up walking history under live hands, with retries)
    const shuffled = emptyHudProfile(U(5), 'plo5');
    for (const x of [...specs].reverse()) {
      expect(applyHudHand(shuffled, rec(x))).toBeNull();
      expect(applyHudHand(shuffled, rec(x))).toBe('duplicate');
    }
    // the first hand left the ring of recent ids long ago; the day list still refuses it
    expect(inOrder.ids.includes(H(1000))).toBe(false);
    expect(applyHudHand(inOrder, rec(specs[0]))).toBe('duplicate');
    expect(shuffled.hands).toBe(200);
    expect(shuffled.life).toEqual(inOrder.life);
    expect(shuffled.recall).toEqual(inOrder.recall);
    expect(shuffled.last).toEqual(inOrder.last);
    expect(shuffled.dsum).toEqual(inOrder.dsum);
    expect(shuffled.dsumSince).toBe(0);
    // the day sum is what a rebuild from the raw rows gives
    const day = hudDayOf(t);
    let sum = 0;
    for (const x of specs)
      if (hudDayOf(x.at) === day) sum = (sum + hudHandDigest(U(5), rec(x))!) >>> 0;
    expect(inOrder.dsum?.[day]).toBe(sum);
    expect(hudHandDigest(U(77), rec(specs[0]))).toBeNull();
    expect(validHudProfile(inOrder)).toBe(true);
  });

  it('day lists keep the newest HUD_DAYS_KEPT days; a hand of an older day cannot be proven and is refused', () => {
    const p = emptyHudProfile(U(5), 'plo5');
    const t = 1_800_000_000_000;
    applyHudHand(p, rec({ ...S1, id: 40, at: t }));
    const day = hudDayOf(t);
    expect(p.days?.[day]).toEqual([hudIdPrefix(H(40))]);
    expect(p.daysSince).toBe(t);
    for (const [i, h] of [30, 60, 90].entries())
      expect(applyHudHand(p, rec({ ...S1, id: 43 + i, at: t + h * 3600_000 }))).toBeNull();
    expect(HUD_DAYS_KEPT).toBe(3);
    expect(Object.keys(p.days ?? {}).length).toBe(HUD_DAYS_KEPT);
    expect(Object.keys(p.dsum ?? {}).sort()).toEqual(Object.keys(p.days ?? {}).sort());
    expect(p.days?.[day]).toBeUndefined();
    // a hand of the dropped day, never applied: no list can prove that, so it is refused and counted as stale
    expect(applyHudHand(p, rec({ ...S1, id: 41, at: t + 60_000 }))).toBe('stale');
    // a hand of the oldest listed day is still provable
    expect(applyHudHand(p, rec({ ...S1, id: 42, at: t + 30 * 3600_000 + 1000 }))).toBeNull();
    expect(p.hands).toBe(5);
    expect(validHudProfile(p)).toBe(true);
  });

  it('recency layer decays, lifetime layer never does', () => {
    const p = emptyHudProfile(U(5), 'plo5');
    applyHudHand(p, rec({ ...S1, id: 20, at: 1_800_000_000_000 }));
    applyHudHand(p, rec({ ...S1, id: 21, at: 1_800_000_000_000 + 7 * 24 * 3600 * 1000 }));
    expect(p.life['pf.vpip']).toEqual([2, 2]);
    expect(p.rec['pf.vpip'][0]).toBeCloseTo(1.5, 6);
  });

  it('double-board bomb pots and other games are refused; nothing else is', () => {
    expect(handRecordFromRow(row({ ...S1, extra: { community_cards2: ['Ah'] } }))).toBe(
      'multi_board'
    );
    expect(
      handRecordFromRow(row({ ...S1, extra: { bomb_pot: { ante_amount: 2, board_count: 2 } } }))
    ).toBe('multi_board');
    expect(handRecordFromRow(row({ ...S1, extra: { game_variant: 'plo6' } }))).toBe('not_plo45');
  });

  // OPPONENT-HUD-FIX-1 (AUDIT-C items 7-8; lead ruling 2026-11-21 18:38Z): tournaments, run-it-twice and single-board
  // bomb pots are counted, from public fields only
  it('a PLO tournament hand is counted into the same profile, marked tournament (no stake band from its chips)', () => {
    const r = handRecordFromRow(row({ ...S1, extra: { tournament_id: H(99) } }));
    expect(typeof r).toBe('object');
    expect((r as HudHandRecord).tournament).toBe(true);
    const cash = rec(S1);
    expect(cash.tournament).toBeUndefined();
    const p = emptyHudProfile(U(6), 'plo5');
    expect(applyHudHand(p, r as HudHandRecord)).toBeNull();
    expect(p.hands).toBe(1);
    expect(p.life['pf.pfr']).toEqual([1, 1]);
  });

  it('a run-it-twice hand is counted once: every action, the first board, the public showdown of every board', () => {
    const rit = row({
      ...S1,
      id: 40,
      board: ['Ah', 'Kd', '7c', '2s', '3h'],
      extra: { rit_boards: [['9h', '9d', '9c', '4s', '5h']] },
    });
    const r = handRecordFromRow(rit);
    expect(typeof r).toBe('object');
    const p = emptyHudProfile(U(6), 'plo5');
    expect(applyHudHand(p, r as HudHandRecord)).toBeNull();
    expect(applyHudHand(p, handRecordFromRow(rit) as HudHandRecord)).not.toBeNull(); // once
    expect(p.hands).toBe(1);
    expect(p.life['pf.vpip']).toEqual([1, 1]);
  });

  it('a single-board bomb pot is counted postflop only; its antes are dead money in the pot', () => {
    const bomb: Spec = {
      id: 41,
      button: 3,
      seats: [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      acts: [
        ['preflop', 1, 'bomb_ante', 2],
        ['preflop', 2, 'bomb_ante', 2],
        ['preflop', 3, 'bomb_ante', 2],
        ['flop', 1, 'bet', 6],
        ['flop', 2, 'fold', 0],
        ['flop', 3, 'call', 6],
      ],
      board: ['Ah', 'Kd', '7c'],
      extra: { bomb_pot: { trigger_reason: 'every_n_hands', ante_amount: 2, board_count: 1 } },
    };
    const r = handRecordFromRow(row(bomb));
    expect(typeof r).toBe('object');
    for (const u of [1, 2, 3]) {
      const p = emptyHudProfile(U(u), 'plo5');
      expect(applyHudHand(p, r as HudHandRecord)).toBeNull();
      expect(p.hands).toBe(1);
      // nobody had a preflop decision in a bomb pot: no preflop opportunity at all
      expect(p.life['pf.vpip']).toBeUndefined();
      expect(p.life['pf.pfr']).toBeUndefined();
      const flop = p.last.filter((i) => i.s === 'flop');
      expect(flop.length).toBe(1);
      // the bet of 6 into the 6 of antes is pot-sized ('l'), never an overbet into an empty pot
      expect(flop.every((i) => i.b === '-' || i.b === 'l')).toBe(true);
    }
    const caller = emptyHudProfile(U(3), 'plo5');
    applyHudHand(caller, r as HudHandRecord);
    expect(caller.last.find((i) => i.s === 'flop')!.b).toBe('l');
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

/** 3 opens, 4 three-bets, 5 four-bets, 6 calls the 4-bet cold, the blinds and the opener fold, the 3-bettor answers */
function fourBetPot(id: number, answer: 'call' | 'fold'): Spec {
  return {
    id,
    button: 6,
    seats: [1, 2, 3, 4, 5, 6].map((s) => [s, s, 1000] as [number, number, number]),
    acts: [
      ['preflop', 1, 'sb', 1],
      ['preflop', 2, 'bb', 2],
      ['preflop', 3, 'raise', 7],
      ['preflop', 4, 'raise', 24],
      ['preflop', 5, 'raise', 80],
      ['preflop', 6, 'call', 80],
      ['preflop', 1, 'fold', 0],
      ['preflop', 2, 'fold', 0],
      ['preflop', 3, 'fold', 0],
      answer === 'call' ? ['preflop', 4, 'call', 56] : ['preflop', 4, 'fold', 0],
    ],
    winners: [5],
  };
}
function generatedHistories(): Spec[] {
  const out: Spec[] = [S1, S2];
  let id = 100;
  // a multiway flop stab after two checks (stab size cell, 2026-11-21)
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
      ['preflop', 3, 'call', 2],
      ['preflop', 1, 'call', 1],
      ['preflop', 2, 'check', 0],
      ['flop', 1, 'check', 0],
      ['flop', 2, 'check', 0],
      ['flop', 3, 'bet', 4],
      ['flop', 1, 'fold', 0],
      ['flop', 2, 'fold', 0],
    ],
    board: ['Ah', '7d', '2c'],
    winners: [3],
  });
  // value share by line and size (2026-11-21): leads and raises of both sizes on every street, shown at showdown
  for (const [lead, raiseTo] of [
    [(pot: number) => pot * 0.25, (pot: number, l: number) => l + 1.5 * (pot + 2 * l)],
    [(pot: number) => pot, (pot: number, l: number) => l + 0.2 * (pot + 2 * l)],
  ] as const) {
    const acts: Act[] = [
      ['preflop', 2, 'sb', 1],
      ['preflop', 1, 'bb', 2],
      ['preflop', 2, 'raise', 10],
      ['preflop', 1, 'call', 8],
    ];
    let pot = 20;
    for (const st of ['flop', 'turn', 'river'] as const) {
      const l = Math.round(lead(pot) * 100) / 100;
      const r = Math.round(raiseTo(pot, l) * 100) / 100;
      acts.push(
        [st, 1, 'bet', l],
        [st, 2, 'raise', r],
        [st, 1, 'call', Math.round((r - l) * 100) / 100]
      );
      pot += 2 * r;
    }
    out.push({
      id: id++,
      button: 2,
      seats: [
        [1, 1, 100000],
        [2, 2, 100000],
      ],
      acts,
      board: ['Ah', '7d', '2c', 'Kd', '9s'],
      showdown: [
        [2, false, 'Full House'],
        [1, false, 'Pair'],
      ],
      winners: [2],
    });
  }
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
  // 4-bet pots (2026-11-21, REPLACEMENTS-2)
  for (const answer of ['call', 'fold'] as const) out.push(fourBetPot(id++, answer));
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
    for (const [stack, band] of DEPTH_STACKS) {
      const p = emptyHudProfile(U(2), 'plo5');
      applyHudHand(p, depthHand(stack));
      expect(p.life[`pf.vpip@${band}`]).toEqual([1, 1]);
      expect(p.life[`pf.pfr@${band}`]).toEqual([1, 1]);
    }
  });
});

const DEPTH_STACKS = [
  [100, 'd1'],
  [200, 'd2'],
  [400, 'd3'],
] as const;
function depthHand(stack: number): HudHandRecord {
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
  return handRecordFromRow(r) as HudHandRecord;
}

/**
 * EVERY STATISTIC HAS ITS OWN TEST (owner 3:20 PM Nov 20: "SO THEY NEVER BREAK, REGRESS OR MAKE MISTAKES"; lane
 * OPPONENT-HUD-4). One named test per registered statistic: its lifetime count over the constructed histories (every
 * seat of every history, plus the three depth hands) must have an opportunity and equal its pinned row in
 * OpponentHudProfile.stats.pinned.json. A statistic added to the registry without a pinned row fails here, and so
 * does a pinned row whose statistic left the registry; a change of how any statistic is counted fails its own test.
 * The pinned rows are written only by hand: HUD_WRITE_PINNED=1 npx vitest run src/engine/opponentHud/OpponentHudProfile.test.ts
 */
const PINNED_FILE = fileURLToPath(
  new URL('./OpponentHudProfile.stats.pinned.json', import.meta.url)
);
function constructedCounts(): Record<string, [number, number]> {
  const total: Record<string, [number, number]> = {};
  const add = (p: OpponentHudProfile) => {
    for (const [k, c] of Object.entries(p.life)) {
      const cur = (total[k] ??= [0, 0]);
      cur[0] += c[0];
      cur[1] += c[1];
    }
  };
  for (const s of generatedHistories()) {
    const r = rec(s);
    for (const u of s.seats) {
      const p = emptyHudProfile(U(u[1]), 'plo5');
      applyHudHand(p, r);
      add(p);
    }
  }
  for (const [stack] of DEPTH_STACKS)
    for (const u of [1, 2]) {
      const p = emptyHudProfile(U(u), 'plo5');
      applyHudHand(p, depthHand(stack));
      add(p);
    }
  return total;
}
describe('law: every statistic has its own test, and a new one cannot be added without one', () => {
  const counts = constructedCounts();
  if (process.env.HUD_WRITE_PINNED === '1') {
    const rows: Record<string, [number, number]> = {};
    for (const stat of [...HUD_STATS].sort()) rows[stat] = counts[stat] ?? [0, 0];
    writeFileSync(PINNED_FILE, `${JSON.stringify(rows, null, 1)}\n`);
  }
  const pinned = (
    existsSync(PINNED_FILE) ? JSON.parse(readFileSync(PINNED_FILE, 'utf8')) : {}
  ) as Record<string, [number, number]>;
  it.each([...HUD_STATS])(
    '%s: an opportunity in the constructed histories, counted exactly as pinned',
    (stat) => {
      expect(pinned[stat], `statistic ${stat} has no pinned test row`).toBeDefined();
      expect(counts[stat]?.[0] ?? 0).toBeGreaterThan(0);
      expect(counts[stat]).toEqual(pinned[stat]);
    }
  );
  it('the pinned table holds exactly the registry (the context statistics among them)', () => {
    expect(Object.keys(pinned).sort()).toEqual([...HUD_STATS].sort());
    expect(HUD_CONTEXT_STATS.length).toBeGreaterThanOrEqual(40);
    for (const stat of HUD_CONTEXT_STATS) expect(pinned[stat][0]).toBeGreaterThan(0);
  });
});

/**
 * PROFILE SIZE (2026-11-21, lane OPPONENT-HUD-5): measured, and bounded. The only part of a profile that grows with
 * the hands dealt is the day lists, by HUD_DAY_ENTRY_BYTES a hand, for HUD_DAYS_KEPT days; everything else is the
 * registered statistics and capped lists. Production measurement in the comment of HUD_PROFILE_FIXED_MAX_BYTES.
 */
describe('opponent HUD profile: size is measured and bounded', () => {
  const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x ?? null));
  function replay(hands: number, perDay: number): OpponentHudProfile {
    const base = generatedHistories();
    const p = emptyHudProfile(U(1), 'plo5');
    const day0 = Date.UTC(2026, 10, 1, 12);
    for (let i = 0; i < hands; i++) {
      const s = base[i % base.length];
      const at = day0 + Math.floor(i / perDay) * 86_400_000 + (i % perDay) * 20_000;
      const r = handRecordFromRow({
        ...row({ ...s, id: 900_000 + i }),
        created_at: new Date(at).toISOString(),
      });
      if (typeof r !== 'string') applyHudHand(p, r);
    }
    return p;
  }
  it('everything but the day lists stops growing; the day lists hold three days at 15 bytes a hand', () => {
    const small = replay(1_500, 500);
    const big = replay(12_000, 3_000); // four days of a Horse on several tables
    expect(big.hands).toBeGreaterThan(8_000);
    const fixedSmall = bytes(small) - bytes(small.days);
    const fixedBig = bytes(big) - bytes(big.days);
    expect(fixedBig).toBeLessThanOrEqual(HUD_PROFILE_FIXED_MAX_BYTES);
    // eight times the hands: the fixed part grows by digits of its counters only
    expect(fixedBig - fixedSmall).toBeLessThan(4_000);
    expect(Object.keys(big.days ?? {}).length).toBe(HUD_DAYS_KEPT);
    const listed = hudDayListHands(big);
    expect(listed).toBeLessThanOrEqual(HUD_DAYS_KEPT * 3_000);
    expect(bytes(big.days)).toBeLessThanOrEqual(HUD_DAY_ENTRY_BYTES * listed + 20 * HUD_DAYS_KEPT);
    for (const p of [small, big]) expect(bytes(p)).toBeLessThanOrEqual(hudProfileBytesBound(p));
    expect(validHudProfile(JSON.parse(JSON.stringify(big)))).toBe(true);
  });
});

describe('opponent HUD profile: the statistics added for the priced replacements (2026-11-21)', () => {
  const life = (user: number, specs: Spec[]) => profileAfter(user, specs).life;
  it('pf.f4bet / pf.c4bet: the 3-bettor facing a 4-bet; pf.cold4: no chips in voluntarily, facing a 4-bet', () => {
    const both = [fourBetPot(7001, 'call'), fourBetPot(7002, 'fold')];
    expect(life(4, both)['pf.f4bet']).toEqual([2, 1]);
    expect(life(4, both)['pf.c4bet']).toEqual([2, 1]);
    expect(life(4, both)['pf.cold4']).toBeUndefined();
    expect(life(6, both)['pf.cold4']).toEqual([2, 2]); // called both cold
    expect(life(1, both)['pf.cold4']).toEqual([2, 0]); // the blinds had the chance and folded
    expect(life(2, both)['pf.cold4']).toEqual([2, 0]);
    expect(life(3, both)['pf.cold4']).toBeUndefined(); // the opener has chips in: not cold
    expect(life(3, both)['pf.f4bet']).toBeUndefined(); // and did not 3-bet
    expect(life(5, both)['pf.f4bet']).toBeUndefined(); // the 4-bettor faces nothing
  });
  it.each([
    ['flop', 'f'],
    ['turn', 't'],
    ['river', 'r'],
  ] as const)(
    '%s: rBet by players, the raise size, and the first bettor re-raising',
    (street, sk) => {
      const hand = (id: number, players: 2 | 3, reraise: boolean): Spec => {
        const seats = (players === 2 ? [1, 2] : [1, 2, 3]).map(
          (s) => [s, s, 100_000] as [number, number, number]
        );
        const acts: Act[] = [
          ['preflop', 1, 'sb', 1],
          ['preflop', 2, 'bb', 2],
        ];
        if (players === 3)
          acts.push(
            ['preflop', 3, 'raise', 500],
            ['preflop', 1, 'call', 499],
            ['preflop', 2, 'call', 498]
          );
        else acts.push(['preflop', 1, 'raise', 500], ['preflop', 2, 'call', 498]);
        const pot = players * 500;
        for (const st of ['flop', 'turn', 'river'] as const) {
          if (st !== street) {
            for (const [s] of seats) acts.push([st, s, 'check', 0]);
            continue;
          }
          // 2 bets half the pot, 1 raises: the raise over the call is 0.75 of the pot after his call
          const bet = pot / 2;
          const raiseTo = bet + 0.75 * (pot + 2 * bet);
          if (players === 3) acts.push([st, 3, 'check', 0]);
          acts.push(
            [st, 2, 'bet', bet],
            ...(players === 3 ? ([[st, 3, 'fold', 0]] as Act[]) : []),
            [st, 1, 'raise', raiseTo]
          );
          acts.push(reraise ? [st, 2, 'raise', raiseTo * 3] : [st, 2, 'call', raiseTo - bet]);
          break;
        }
        return {
          id,
          button: players,
          seats,
          acts,
          board: ['Ah', '7d', '2c', '9s', '3h'],
          winners: [1],
        };
      };
      const specs = [hand(7101, 2, true), hand(7102, 2, false), hand(7103, 3, false)];
      const raiser = life(1, specs);
      expect(raiser[`${sk}.rBet`]).toEqual([3, 3]);
      expect(raiser[`${sk}.rBet.hu`]).toEqual([2, 2]);
      expect(raiser[`${sk}.rBet.mw`]).toEqual([1, 1]); // three were live when the bet was made
      expect(raiser[`${sk}.rBetsz`][0]).toBe(3);
      expect(raiser[`${sk}.rBetsz`][1]).toBeCloseTo(3 * 0.375, 9); // 0.75 of the pot after the call, halved
      const bettor = life(2, specs);
      expect(bettor[`${sk}.fRaise`]).toEqual([3, 0]);
      expect(bettor[`${sk}.rRaise`]).toEqual([3, 1]);
      expect(bettor[`${sk}.rBetsz`]).toBeUndefined();
      const folder = life(3, specs);
      expect(folder[`${sk}.rBet.mw`]).toEqual([1, 0]);
      expect(folder[`${sk}.rBet.hu`]).toBeUndefined();
    }
  );
});
