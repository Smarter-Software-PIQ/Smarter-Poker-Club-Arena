/**
 * OPPONENT HUD LAWS (2026-11-20, PLO-OWNER lane OPPONENT-HUD). Owner 3:15 / 3:18 / 3:20 PM Chicago Nov 20; lead
 * ruling 3:19 PM: a per-opponent read from the opponent's lifetime PUBLIC history, one mechanism and one formula for
 * every opponent, person or Horse, used from hand one; never an unshown card; no person/Horse branch; no named player.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  HUD_STATS,
  applyHudHand,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
} from './OpponentHudProfile.js';
import {
  HUD_PACKET_MAX_FINE_CELLS,
  buildHudPacket,
  clearDecisionHud,
  fitHudPriors,
  hudRecall,
  hudStat,
  installDecisionHud,
  parseHudPopulation,
  priorsForStake,
  HUD_STAKE_PRIOR_MIN_N,
} from './OpponentHud.js';
import { hudExploitCounters, HUD_EXPLOIT_HANDS_CAP } from './OpponentHudExploit.js';

const here = dirname(fileURLToPath(import.meta.url));
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CARD = /\b([2-9TJQKA][shdc])\b|hearts|spades|diamonds|clubs/i;

/** A PLO5 hand: seat 1 opens, seat 2 calls, flop bet / call, turn bet / fold; seat 2 MUCKS at no showdown. The rows
 *  carry dealt cards in players[].cards and hole_cards on purpose. */
function row(id: number, a: number, b: number, extra: Record<string, unknown> = {}) {
  return {
    id: H(id),
    created_at: new Date(1_800_000_000_000 + id * 60_000).toISOString(),
    game_variant: 'plo5',
    tournament_id: null,
    big_blind: 2,
    button_seat: 1,
    players: [
      { seat: 1, userId: U(a), stack: 400, cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'] },
      { seat: 2, userId: U(b), stack: 400, cards: ['2c', '3c', '4c', '5d', '7h'] },
    ],
    hole_cards: { [U(a)]: ['As', 'Ks'], [U(b)]: ['2c', '3c'] },
    actions: [
      { seat: 1, userId: U(a), stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 2, userId: U(b), stage: 'preflop', action: 'bb', amount: 2 },
      { seat: 1, userId: U(a), stage: 'preflop', action: 'raise', amount: 6 },
      { seat: 2, userId: U(b), stage: 'preflop', action: 'call', amount: 4 },
      { seat: 2, userId: U(b), stage: 'flop', action: 'check', amount: 0 },
      { seat: 1, userId: U(a), stage: 'flop', action: 'bet', amount: 8 },
      { seat: 2, userId: U(b), stage: 'flop', action: 'call', amount: 8 },
      { seat: 2, userId: U(b), stage: 'turn', action: 'check', amount: 0 },
      { seat: 1, userId: U(a), stage: 'turn', action: 'bet', amount: 28 },
      { seat: 2, userId: U(b), stage: 'turn', action: 'fold', amount: 0 },
    ],
    community_cards: ['9h', '8d', '2s', 'Kc'],
    showdown: [],
    winners: [{ userId: U(a), amount: 40 }],
    ...extra,
  };
}
const rec = (r: unknown) => handRecordFromRow(r) as HudHandRecord;
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

afterEach(() => clearDecisionHud());

describe('law: no card that was not shown can enter a profile', () => {
  it('the public record copies no card from the players or the hole cards', () => {
    const r = rec(row(1, 1, 2));
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/"cards"|hole_cards/);
    // the only cards in the record are the public board
    const nonBoard = json.replace(JSON.stringify(r.board), '');
    expect(nonBoard).not.toMatch(CARD);
  });
  it('a profile built from hands with dealt cards and a mucked showdown carries no card', () => {
    const p = emptyHudProfile(U(2), 'plo5');
    applyHudHand(
      p,
      rec(
        row(2, 1, 2, { showdown: [{ seat: 2, user_id: U(2), mucked: true, hand_name: 'Flush' }] })
      )
    );
    applyHudHand(p, rec(row(3, 1, 2)));
    expect(JSON.stringify(p)).not.toMatch(CARD);
    // a mucked showdown entry reveals nothing: no strength, no shown count
    expect(p.recall['flop|b1x']?.[6] ?? 0).toBe(0);
  });
  it('the profile source never reads a player card field', () => {
    for (const f of ['OpponentHudProfile.ts', 'OpponentHud.ts', 'OpponentHudExploit.ts']) {
      const code = strip(readFileSync(join(here, f), 'utf8'));
      expect(code, f).not.toMatch(/\.cards\b|\[\s*''\s*\]\.cards|hole_cards|holeCards/);
    }
    // the only property names read off a player are seat, userId and stack
    const src = readFileSync(join(here, 'OpponentHudProfile.ts'), 'utf8');
    const block = src.slice(
      src.indexOf('for (const p of arr(r.players))'),
      src.indexOf('const actions: HudPublicAction[] = [];')
    );
    expect([...new Set([...block.matchAll(/o\.([A-Za-z_]+)/g)].map((m) => m[1]))].sort()).toEqual([
      'seat',
      'stack',
      'userId',
    ]);
  });
});

describe('law: one formula for every opponent; no kind branch, no named player', () => {
  it('two players with the same public history get identical profiles and reads whatever their ids', () => {
    const p1 = emptyHudProfile(U(10), 'plo5');
    const p2 = emptyHudProfile(U(77), 'plo5');
    for (let i = 0; i < 5; i++) {
      applyHudHand(p1, rec(row(100 + i, 10, 2)));
      applyHudHand(
        p2,
        rec(
          row(200 + i, 77, 2, {
            created_at: new Date(1_800_000_000_000 + (100 + i) * 60_000).toISOString(),
          })
        )
      );
    }
    const norm = (p: typeof p1) =>
      JSON.stringify({
        ...p,
        user: '',
        days: undefined,
        daysSince: undefined,
        ids: [],
        wm: 0,
        recAt: 0,
        last: p.last.map((l) => ({ ...l, h: '', at: 0 })),
      });
    expect(norm(p1)).toBe(norm(p2));
    const pri = fitHudPriors([p1, p2]);
    installDecisionHud(buildHudPacket('plo5', [p1, p2], pri, 1_800_100_000_000, 'flop'));
    for (const stat of HUD_STATS) {
      const a = hudStat(U(10), 'plo5', stat, undefined, false);
      const b = hudStat(U(77), 'plo5', stat, undefined, false);
      expect({ ...a }).toEqual({ ...b });
    }
  });
  it('no source in the HUD path names a person or Horse kind, a roster flag or a player name', () => {
    const files = ['OpponentHudProfile.ts', 'OpponentHud.ts', 'OpponentHudExploit.ts'].map((f) =>
      join(here, f)
    );
    files.push(join(here, '../../services/OpponentHudStore.ts'));
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(
        /is_?horse|isHuman|human|person|has_human|savedProfile|username|\bbot\b/i
      );
      expect(code, f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});

describe("law: the profile is used from an opponent's first hand of a session", () => {
  it('a lifetime profile answers at his first decision, with no hand of this session observed', () => {
    const life = emptyHudProfile(U(5), 'plo5');
    for (let i = 0; i < 40; i++) applyHudHand(life, rec(row(300 + i, 5, 2)));
    // a new session: nothing observed in process; the packet comes from the stored lifetime profile
    installDecisionHud(
      buildHudPacket('plo5', [life], {}, 1_800_000_000_000 + 400 * 60_000, 'preflop')
    );
    const r = hudStat(U(5), 'plo5', 'pf.pfr', 0.2, false);
    expect(r.source).toBe('lifetime');
    expect(r.n).toBeGreaterThan(9);
    expect(r.p!).toBeGreaterThan(0.5);
    const counters = hudExploitCounters(U(5), 'plo5');
    expect(counters!.hands).toBeGreaterThan(9);
    expect(counters!.pfr / counters!.hands).toBeCloseTo(1, 6);
  });
  it('no sample cliff: one observation already moves the read, in proportion to its evidence', () => {
    const p = emptyHudProfile(U(6), 'plo5');
    applyHudHand(p, rec(row(500, 6, 2)));
    installDecisionHud(
      buildHudPacket(
        'plo5',
        [p],
        { 'pf.pfr': [0.2, 20] },
        1_800_000_000_000 + 500 * 60_000,
        'preflop'
      )
    );
    const one = hudStat(U(6), 'plo5', 'pf.pfr', undefined, false);
    expect(one.n).toBeGreaterThan(0);
    expect(one.p!).toBeGreaterThan(0.2);
    expect(one.weight).toBeCloseTo(one.n / (one.n + 20), 9);
    const none = hudStat(U(999), 'plo5', 'pf.pfr', undefined, false);
    expect(none.source).toBe('prior');
    expect(none.p).toBe(0.2);
  });
  it('the lifetime read is capped for the exploit counters but never discarded', () => {
    const p = emptyHudProfile(U(7), 'plo5');
    for (let i = 0; i < 400; i++) applyHudHand(p, rec(row(1000 + i, 7, 2)));
    installDecisionHud(
      buildHudPacket('plo5', [p], {}, 1_800_000_000_000 + 1400 * 60_000, 'preflop')
    );
    expect(hudExploitCounters(U(7), 'plo5')!.hands).toBeLessThanOrEqual(
      HUD_EXPLOIT_HANDS_CAP + 1e-9
    );
    expect(hudStat(U(7), 'plo5', 'pf.vpip', undefined, false).n).toBeGreaterThan(
      HUD_EXPLOIT_HANDS_CAP / 3
    );
  });
});

describe('law: the helpers never throw into a decision', () => {
  it('a malformed packet installs nothing and every read answers the prior', () => {
    for (const bad of [null, 1, 'x', { v: 9 }, { v: 1, pv: 1, family: 'plo6', pri: {}, opp: {} }]) {
      installDecisionHud(bad);
      expect(hudStat(U(1), 'plo5', 'pf.vpip', 0.4, false)).toMatchObject({
        source: 'prior',
        p: 0.4,
      });
      expect(hudRecall(U(1), 'plo5', { street: 'flop', line: 'b1' }, false).levels).toEqual([]);
      expect(hudExploitCounters(U(1), 'plo5')).toBeUndefined();
    }
  });
  it('an unregistered statistic is never answered from a profile', () => {
    const p = emptyHudProfile(U(8), 'plo5');
    applyHudHand(p, rec(row(600, 8, 2)));
    installDecisionHud(buildHudPacket('plo5', [p], {}, 1_800_000_000_000 + 600 * 60_000, 'flop'));
    expect(hudStat(U(8), 'plo5', 'pf.secret', 0.3, false).source).toBe('prior');
  });
  it('the packet is bounded', () => {
    const p = emptyHudProfile(U(9), 'plo5');
    for (let i = 0; i < 50; i++) p.recall[`flop|b1|m|EP|dry|d${i}`] = [1, 0, 1, 0, 0, 0, 0, 0, 0];
    const pk = buildHudPacket('plo5', [p], {}, 0, 'flop');
    expect(
      Object.keys(pk.opp[U(9)].rc).filter((k) => k.split('|').length === 6).length
    ).toBeLessThanOrEqual(HUD_PACKET_MAX_FINE_CELLS);
  });
});

describe('law: hand-level recall answers "what has he done here before"', () => {
  it('returns his past instances of the spot with what he did', () => {
    const p = emptyHudProfile(U(2), 'plo5');
    for (let i = 0; i < 6; i++) applyHudHand(p, rec(row(700 + i, 1, 2)));
    installDecisionHud(buildHudPacket('plo5', [p], {}, 1_800_000_000_000 + 800 * 60_000, 'turn'));
    const r = hudRecall(U(2), 'plo5', { street: 'turn', line: 'b1x' }, false);
    expect(r.levels[0]).toMatchObject({ key: 'turn|b1x', instances: 6, did: { fold: 6 } });
  });
});

describe('law: a new opponent starts from the population prior of his stake and game', () => {
  it('the stake band rate replaces the family prior only with evidence; k stays the family k', () => {
    const pop = parseHudPopulation({
      family: { 'pf.vpip': [0.41, 11], 'pf.pfr': [0.2, 46] },
      stakes: { b2: { 'pf.vpip': [0.5, HUD_STAKE_PRIOR_MIN_N], 'pf.pfr': [0.3, 10] } },
    })!;
    expect(priorsForStake(pop, 2)).toEqual({ 'pf.vpip': [0.5, 11], 'pf.pfr': [0.2, 46] });
    expect(priorsForStake(pop, 0.5)).toEqual({ 'pf.vpip': [0.41, 11], 'pf.pfr': [0.2, 46] });
    expect(priorsForStake(pop, null)).toEqual({ 'pf.vpip': [0.41, 11], 'pf.pfr': [0.2, 46] });
    // a flat stored map (older row) is the family prior
    expect(parseHudPopulation({ 'pf.vpip': [0.4, 10] })).toEqual({
      family: { 'pf.vpip': [0.4, 10] },
      stakes: {},
    });
    expect(parseHudPopulation('x')).toBeNull();
    installDecisionHud(buildHudPacket('plo5', [], priorsForStake(pop, 2), 0, 'preflop'));
    expect(hudStat(U(123), 'plo5', 'pf.vpip', undefined, false)).toMatchObject({
      source: 'prior',
      p: 0.5,
    });
  });
});
