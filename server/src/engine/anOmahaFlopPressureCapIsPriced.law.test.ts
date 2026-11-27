/**
 * LAW (PLO-OWNER lead-7 2026-11-26; owner order "the stats need to be used against human players, not horses"):
 * omahaFlopPressureCapIsPriced (default OFF). Heads-up on the PLO4/PLO5 cash flop, facing a single bet, where the V40
 * Omaha pressure cap prices a weak made class, the reference call-or-fold check reads the Horse's equity against the
 * bettor's range (the flop verdict's value region plus the PEOPLE-ONLY measured flop non-value share, blended toward
 * the balanced share at 30 pseudo-bets, moved by his own shown flop bets) in place of the class ceiling.
 *
 *  1. The flop population is people only: the fit counts a flop bet only when a PERSON made it and reads only cards a
 *     PERSON showed (mucked = false, the export's filter); its own random stream leaves the turn and river cells as
 *     they were. The bettor-answered-by-a-person cell is too thin to fit alone and is recorded, not used.
 *  2. The blend: (n x people + 30 x balanced) / (n + 30); the balanced share of a flop bet is 1 - (1 - b)^3 with the
 *     turn and the river to come, b on a final call.
 *  3. His own record moves it in the record's unit (people's not-top-20% share of the cell): value shown lowers it,
 *     weak shown raises it; a raise is never priced here.
 *  4. On the 445 audited heads-up flop decisions (live options of the audit, own cards only): against people's bets
 *     over 0.8 pot the Horse folds less than today; bets under 0.8 pot are not folded more; no decision becomes or
 *     stops being a raise; a decision the option did not price is identical.
 *  5. The turn, the river, a raise, a multiway pot, PLO6 and tournaments decide exactly as with the option off.
 *  6. v87DeepDiveDiscipline is untouched: the option is a separate branch before the V40 block, which still runs as
 *     it did; with v87DeepDiveDiscipline on or off, every decision outside the scope is identical with the option on
 *     and off, and the v87 receipts are the same in every spot.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaFlopFacingBetEvSpot } from './HorseOmahaFlopFacingBetEv.js';
import { omahaEquilibriumAnchor } from './HorseOmahaEquilibriumAnchor.js';
import {
  OMAHA_PEOPLE_PRIOR_ANCHOR_BETS,
  OMAHA_PEOPLE_PRIOR_RECORD_BETS,
  omahaFlopBalancedShare,
  omahaFlopPeoplePriorShare,
  omahaPeopleFlopCell,
} from './HorseOmahaFacingBetPeoplePrior.js';
import { OMAHA_FACING_BET_PEOPLE_PRIOR_DATA } from './HorseOmahaFacingBetPeoplePrior.data.js';
import { loadPricedStates } from './HorseOmahaFacingBetPriced.test-support.js';
import {
  flopCapDecide,
  flopCapKey,
  loadFlopCapNodes,
  type FlopCapNode,
} from './HorseOmahaFlopPressureCap.test-support.js';

const OPTION = 'omahaFlopPressureCapIsPriced';
const SEEDS = [1, 7, 42];
const nodes = loadFlopCapNodes();
const potFracOf = (n: FlopCapNode): number => n.toCallBb / Math.max(1e-9, n.potBb - n.toCallBb);

/** Majority action over the seeds. */
function majority(n: { player: SeatPlayer; gs: HorseGameStateV2 }, opts: Record<string, unknown>) {
  const kinds: Record<string, number> = {};
  const fired = new Set<string>();
  for (const seed of SEEDS) {
    const r = flopCapDecide(n.player, n.gs, opts, seed);
    kinds[r.decision.action] = (kinds[r.decision.action] ?? 0) + 1;
    for (const f of r.fired) fired.add(f);
  }
  const action = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])[0];
  return { action, kinds, fired };
}

describe('LAW: the flop pressure cap is priced on the bettor range (omahaFlopPressureCapIsPriced)', () => {
  it('1. the flop population is people only, and the people-answered cell is recorded as too thin', () => {
    const fit = readFileSync(
      join(__dirname, '../../scripts/omaha-facing-bet-people-prior-fit.ts'),
      'utf8'
    );
    const sql = readFileSync(
      join(__dirname, '../../scripts/omaha-facing-bet-people-prior-export.sql'),
      'utf8'
    );
    // a flop bet is counted only when a person made it
    expect(fit).toMatch(/if \(person && Number\.isFinite\(frac\) && frac > 0\) \{\s*const bucket/);
    expect(fit).toContain("return !!p && p.isHorse === false && a.origin !== 'horse_policy';");
    // only cards a person showed: the export keeps mucked = false people only, the fit re-checks the seat
    expect(sql).toContain("coalesce((s->>'mucked')::boolean, false) = false");
    expect(sql).toContain('coalesce(p.is_horse, true) = false');
    expect(fit).toMatch(/for \(const b of pendingFlop\) \{[\s\S]*?p\.isHorse !== false/);
    // its own stream: the turn and river cells keep theirs
    expect(fit).toContain('beatShare(cards, board.slice(0, 3), rndFlop)');
    const D = OMAHA_FACING_BET_PEOPLE_PRIOR_DATA;
    expect(D.source).toBe('people-only');
    expect(D.flop.hu.big.n).toBeGreaterThanOrEqual(300);
    const huAnswered = (['under40', 'mid', 'big', 'raise'] as const).reduce(
      (s, b) => s + D.flop.hu[b].answeredByAPerson,
      0
    );
    expect(huAnswered).toBeLessThan(100);
  });

  it('2. the blend and the balanced share of a flop bet', () => {
    for (const [potFrac, final] of [
      [0.3, false],
      [0.55, false],
      [0.9, false],
      [1, true],
    ] as const) {
      const winnable = 10;
      const paid = potFrac * winnable;
      const b = omahaEquilibriumAnchor(paid, winnable, 0.05, false)!;
      const bal = omahaFlopBalancedShare(paid, winnable, 0.05, final)!;
      expect(bal).toBeCloseTo(Math.min(0.65, final ? b : 1 - (1 - b) ** 3), 9);
      const cell = omahaPeopleFlopCell(potFrac, false, false);
      const r = omahaFlopPeoplePriorShare({
        potFrac,
        isRaise: false,
        multiway: false,
        paid,
        winnable,
        rake: 0.05,
        final,
        record: null,
      })!;
      expect(cell.n).toBeGreaterThan(100);
      expect(r.prior).toBeCloseTo(
        (cell.n * cell.share! + OMAHA_PEOPLE_PRIOR_ANCHOR_BETS * bal) /
          (cell.n + OMAHA_PEOPLE_PRIOR_ANCHOR_BETS),
        9
      );
      expect(r.share).toBeCloseTo(r.prior, 9);
    }
  });

  it('3. his own shown flop bets move it in the record unit; a raise reads no record', () => {
    const base = {
      potFrac: 0.9,
      isRaise: false,
      multiway: false,
      paid: 9,
      winnable: 10,
      rake: 0,
      final: false,
    };
    const none = omahaFlopPeoplePriorShare({ ...base, record: null })!;
    const valueOnly = omahaFlopPeoplePriorShare({ ...base, record: { shown: 20, value: 20 } })!;
    const weak = omahaFlopPeoplePriorShare({ ...base, record: { shown: 20, value: 0 } })!;
    const pNT = omahaPeopleFlopCell(0.9, false, false).nonTop20!;
    expect(valueOnly.share).toBeCloseTo(
      (none.prior * (OMAHA_PEOPLE_PRIOR_RECORD_BETS * pNT)) /
        (OMAHA_PEOPLE_PRIOR_RECORD_BETS + 20) /
        pNT,
      9
    );
    expect(valueOnly.share).toBeLessThan(none.share / 2);
    expect(weak.share).toBeGreaterThan(none.share);
    const raise = omahaFlopPeoplePriorShare({
      ...base,
      isRaise: true,
      record: { shown: 20, value: 20 },
    })!;
    expect(raise.shown).toBe(0);
  });

  describe('4. the audited heads-up flop decisions', () => {
    const rows = nodes.map((n) => {
      const off = majority(n, n.opts);
      const on = majority(n, { ...n.opts, [OPTION]: true });
      return { n, off, on, f: potFracOf(n) };
    });
    it('people bets over 0.8 pot are folded less, smaller bets not more, nothing else moves', () => {
      const rate = (sel: typeof rows, arm: 'off' | 'on') =>
        sel.filter((r) => r[arm].action === 'fold').length / Math.max(1, sel.length);
      const bigP = rows.filter((r) => r.f >= 0.8 && r.n.tag.endsWith('.P'));
      const small = rows.filter((r) => r.f < 0.8);
      expect(bigP.length).toBeGreaterThanOrEqual(90);
      expect(rate(bigP, 'on')).toBeLessThan(rate(bigP, 'off') - 0.1);
      expect(rate(small, 'on')).toBeLessThanOrEqual(rate(small, 'off'));
      for (const r of rows) {
        // only call vs fold changes; no raise appears or disappears
        expect(r.on.kinds.raise ?? 0).toBe(r.off.kinds.raise ?? 0);
        expect(r.on.kinds.all_in ?? 0).toBe(r.off.kinds.all_in ?? 0);
        if (!r.on.fired.has('omaha_flop_pressure_cap_priced'))
          expect(r.on.kinds).toEqual(r.off.kinds);
        expect(r.off.fired.has('omaha_flop_pressure_cap_priced')).toBe(false);
      }
      expect(
        rows.filter((r) => r.on.fired.has('omaha_flop_pressure_cap_priced')).length
      ).toBeGreaterThan(40);
    });
    it('two audited hands decide as stated', () => {
      const find = (own: string, board: string) =>
        rows.find(
          (r) =>
            r.n.player.cards.map((c: Card) => `${c.rank}${String(c.suit)[0]}`).join('') === own &&
            (r.n.gs.communityCards ?? [])
              .map((c: Card) => `${c.rank}${String(c.suit)[0]}`)
              .join('') === board
        )!;
      // a pair of fours with an ace-wheel draw on 2s7c3d facing a pot-sized person bet: the cap folded it; priced, a call
      const a = find('4c5c4sAc', '2s7c3d');
      expect(a.off.action).toBe('fold');
      expect(a.on.action).toBe('call');
      // top two on a monotone 9hTh8h with no heart, facing 0.8 pot: priced against the range, a fold
      const b = find('4s9c7sTd', '9hTh8h');
      expect(b.off.action).toBe('call');
      expect(b.on.action).toBe('fold');
    });
  });

  // out-of-scope variants of real states
  const priced = loadPricedStates();
  const turnRiver = priced.filter((s) => s.gs.stage !== 'flop').filter((_, i) => i % 6 === 0);
  const flopRaises = priced
    .filter((s) => s.gs.stage === 'flop')
    .filter((s) => omahaFlopFacingBetEvSpot(s.player, s.gs)?.isRaise === true)
    .slice(0, 40);
  const opts0 = nodes[0].opts;
  const inScopeFired = nodes.filter((n) =>
    flopCapDecide(n.player, n.gs, { ...n.opts, [OPTION]: true }).fired.has(
      'omaha_flop_pressure_cap_priced'
    )
  );
  const multiway = inScopeFired.slice(0, 40).flatMap((n) => {
    const gs = structuredClone(n.gs);
    const other = gs.players.find((p) => p.seat !== n.player.seat && p.is_folded);
    if (!other) return [];
    other.is_folded = false;
    other.bet = gs.currentBet;
    other.stack = Math.max(other.stack ?? 0, 50 * gs.bigBlind);
    return [{ player: n.player, gs, opts: n.opts }];
  });
  const tournament = inScopeFired.slice(0, 40).map((n) => ({
    player: n.player,
    gs: { ...structuredClone(n.gs), gameMode: 'tournament' } as HorseGameStateV2,
    opts: n.opts,
  }));
  const RANKS = '23456789TJQKA';
  const SUITS = ['hearts', 'spades', 'diamonds', 'clubs'];
  const plo6 = inScopeFired.slice(0, 40).map((n) => {
    const used = new Set(
      [...n.player.cards, ...(n.gs.communityCards ?? [])].map((c) => `${c.rank}${c.suit}`)
    );
    const extra: Card[] = [];
    for (const r of RANKS)
      for (const s of SUITS)
        if (extra.length < 2 && !used.has(`${r}${s}`)) extra.push({ rank: r, suit: s } as Card);
    const player = {
      ...structuredClone(n.player),
      cards: [...n.player.cards, ...extra],
    } as SeatPlayer;
    const gs = structuredClone(n.gs);
    gs.gameVariant = 'plo6' as never;
    for (const p of gs.players) if (p.seat === player.seat) p.cards = player.cards;
    return { player, gs, opts: n.opts };
  });
  const outOfScope: [
    string,
    { player: SeatPlayer; gs: HorseGameStateV2; opts: Record<string, unknown> }[],
  ][] = [
    ['turn and river', turnRiver.map((s) => ({ player: s.player, gs: s.gs, opts: opts0 }))],
    ['a flop raise', flopRaises.map((s) => ({ player: s.player, gs: s.gs, opts: opts0 }))],
    ['a multiway flop', multiway],
    ['a tournament', tournament],
    ['PLO6', plo6],
  ];

  it('5. the turn, the river, a raise, multiway, PLO6 and tournaments decide exactly as off', () => {
    expect(inScopeFired.length).toBeGreaterThan(40);
    for (const [name, set] of outOfScope) {
      expect(set.length, name).toBeGreaterThanOrEqual(20);
      for (const s of set) {
        const off = flopCapDecide(s.player, s.gs, s.opts);
        const on = flopCapDecide(s.player, s.gs, { ...s.opts, [OPTION]: true });
        expect(flopCapKey(on.decision), name).toBe(flopCapKey(off.decision));
        expect(on.fired.has('omaha_flop_pressure_cap_priced'), name).toBe(false);
      }
    }
  });

  it('6. v87DeepDiveDiscipline is untouched: separate branch before the V40 block; identical outside the scope either way', () => {
    const src = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    const mine = src.indexOf('let pricedCap38: number | null = null;');
    const v40 = src.indexOf(
      'if (!noMadeClassCap && useV40 && vi.isOmaha && made40 != null && made40.weak) {'
    );
    expect(mine).toBeGreaterThan(0);
    expect(v40).toBeGreaterThan(mine);
    const branch = src.slice(mine, v40);
    expect(branch).not.toMatch(/v87|DeepDive|withholdFlopLift/);
    // the V40 block still contains the v87 flop-cap lift withhold, unwrapped
    // the V40 block runs to the V20 cap that follows it
    const v20 = src.indexOf('// ═══ V20 NLH-FAMILY EQUITY CAP', v40);
    expect(v20).toBeGreaterThan(v40);
    expect(src.slice(v40, v20)).toContain('opts.v87DeepDiveDiscipline !== false &&');
    for (const v87 of [undefined, false] as const) {
      const extra = v87 === undefined ? {} : { v87DeepDiveDiscipline: v87 };
      for (const [name, set] of outOfScope)
        for (const s of set.slice(0, 15)) {
          const off = flopCapDecide(s.player, s.gs, { ...s.opts, ...extra });
          const on = flopCapDecide(s.player, s.gs, { ...s.opts, ...extra, [OPTION]: true });
          expect(flopCapKey(on.decision), `${name} v87=${String(v87)}`).toBe(
            flopCapKey(off.decision)
          );
          expect([...on.fired].sort().join(',')).toBe([...off.fired].sort().join(','));
        }
      // in the scope the v87 receipts are the same with the option on and off
      for (const n of inScopeFired.slice(0, 30)) {
        const off = flopCapDecide(n.player, n.gs, { ...n.opts, ...extra });
        const on = flopCapDecide(n.player, n.gs, { ...n.opts, ...extra, [OPTION]: true });
        const v87Of = (f: ReadonlySet<string>) =>
          [...f]
            .filter((x) => x.startsWith('v87'))
            .sort()
            .join(',');
        expect(v87Of(on.fired)).toBe(v87Of(off.fired));
      }
    }
  });
});
