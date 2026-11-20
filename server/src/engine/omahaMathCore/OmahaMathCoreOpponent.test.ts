import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPPONENT_MODEL_PROVENANCE,
  OPPONENT_MODEL_SNAPSHOT,
  OPPONENT_MODEL_VERSION,
  OPPONENT_WAGER_TILT_ENABLED,
  opponentFold,
  opponentPassiveMix,
  opponentBetRate,
  opponentPreflop,
  opponentResponse,
  opponentWagerMix,
  type OppActor,
} from './OmahaMathCoreOpponent.js';

const SRC = readFileSync(
  fileURLToPath(new URL('./OmahaMathCoreOpponent.ts', import.meta.url)),
  'utf8'
);
const JSON_TEXT = readFileSync(
  fileURLToPath(new URL('./opponentModel.v1.json', import.meta.url)),
  'utf8'
);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The opponent of a kind with the most public response evidence in `game|street|vs_horse` (chosen by data, never by name). */
function heaviest(actor: OppActor, coarse: string): string {
  let best = '';
  let bestN = -1;
  for (const [id, r] of Object.entries(OPPONENT_MODEL_SNAPSHOT.opponents)) {
    const c = r.a === actor ? r.response[coarse] : undefined;
    if (c && c.nEff > bestN) {
      best = id;
      bestN = c.nEff;
    }
  }
  return best;
}
const POP = { p: 0.4, n: 500, source: 'pop' };
const SPOT = { game: 'plo5', street: 'flop', band: 'pot', players: 'hu', vs: 'horse' } as const;

describe('OPPMODEL laws', () => {
  it('law: no named-player constant exists (no user id or player name literal in source; snapshot carries no names)', () => {
    expect(UUID.test(SRC)).toBe(false);
    expect(JSON_TEXT.includes('"name"')).toBe(false);
  });
  it('law: shipped table is public information only (provenance public_actions|showdown_only; no card/tier fields)', () => {
    expect(['public_actions', 'showdown_only']).toContain(OPPONENT_MODEL_PROVENANCE);
    for (const banned of ['"tiers"', '"tier"', '"made"', '"hole', '"cards"', '"eqjob"', '"draw"'])
      expect(JSON_TEXT.includes(banned)).toBe(false);
  });
  it('law: persons and Horses get a read through the same path', () => {
    for (const actor of ['person', 'horse'] as const) {
      const id = heaviest(actor, 'plo5|flop|vs_horse');
      expect(id).not.toBe('');
      const out = opponentFold(id, actor, SPOT, POP);
      expect(out.source).toContain(OPPONENT_MODEL_VERSION);
      expect(out.source).toContain('public_actions');
    }
  });
  it('law: an opponent of the other kind under the same id gets no read (seat kind is part of the key)', () => {
    const id = heaviest('person', 'plo5|flop|vs_horse');
    expect(opponentFold(id, 'horse', SPOT, POP).p).toBe(POP.p);
  });
  it('unknown opponent returns the population cell unchanged', () => {
    const out = opponentFold('00000000-0000-0000-0000-000000000000', 'person', SPOT, POP);
    expect(out.p).toBe(POP.p);
    expect(out.source).toContain('population');
    expect(opponentFold(null, 'person', SPOT, POP).p).toBe(POP.p);
  });
  it('posterior is a probability, deterministic, and moves toward his own evidence', () => {
    const id = heaviest('person', 'plo5|flop|vs_horse');
    const a = opponentFold(id, 'person', SPOT, POP);
    const b = opponentFold(id, 'person', SPOT, POP);
    expect(a).toEqual(b);
    expect(a.p).toBeGreaterThanOrEqual(0);
    expect(a.p).toBeLessThanOrEqual(1);
    const row = OPPONENT_MODEL_SNAPSHOT.opponents[id].response['plo5|flop|vs_horse'];
    const cell = row.cells['plo5|flop|pot|hu|vs_horse'];
    if (cell) {
      const n = (cell.fold ?? 0) + (cell.call ?? 0) + (cell.raise ?? 0);
      const own = (cell.fold ?? 0) / n;
      // posterior lies between the population-based prior side and his own rate side
      expect(Math.sign(a.p - POP.p) === Math.sign(own - POP.p) || Math.abs(a.p - POP.p) < 0.1).toBe(
        true
      );
    }
  });
  it('never throws on malformed input', () => {
    const bad = { game: 'x', street: 'flop', band: '??', players: 'hu' } as never;
    expect(() =>
      opponentFold('zz', 'person', bad, { p: Number.NaN, n: 0, source: 's' })
    ).not.toThrow();
    expect(() => opponentWagerMix('zz', 'person', bad, null as never)).not.toThrow();
    expect(() =>
      opponentPreflop('zz', 'person', { game: 'x', position: 'BTN', level: 0 }, null as never)
    ).not.toThrow();
  });
  it('scope is PLO4 and PLO5 only: any other game reads the population unchanged', () => {
    const id = heaviest('person', 'plo5|flop|vs_horse');
    expect(opponentFold(id, 'person', { ...SPOT, game: 'plo6' }, POP).p).toBe(POP.p);
    const pf = { fold: 0.3, call: 0.5, raise: 0.2, check: 0, n: 100, source: 'pop' };
    expect(
      opponentPreflop(id, 'person', { game: 'plo6', position: 'BTN', level: 1 }, pf).fold
    ).toBe(0.3);
  });
  it('wager tilt is a failed candidate and stays OFF: population mix returned unchanged', () => {
    expect(OPPONENT_WAGER_TILT_ENABLED).toBe(false);
    const pop = { tiers: { strong: 0.5, air: 0.5 }, key: 'k', n: 100 };
    const id = heaviest('person', 'plo5|flop|vs_horse');
    expect(opponentWagerMix(id, 'person', SPOT, pop).tiers).toEqual(pop.tiers);
    expect(opponentPassiveMix(id, 'person', SPOT, pop).tiers).toEqual(pop.tiers);
  });
  it('preflop posterior sums to one', () => {
    const id = heaviest('person', 'plo5|flop|vs_horse');
    const o = opponentPreflop(
      id,
      'person',
      { game: 'plo5', position: 'BTN', level: 1 },
      { fold: 0.3, call: 0.5, raise: 0.2, check: 0, n: 100, source: 'pop' }
    );
    expect(o.fold + o.call + o.raise + o.check).toBeCloseTo(1, 6);
  });
  it('bet rate and full response are probabilities from public counts', () => {
    const id = heaviest('person', 'plo5|flop|vs_horse');
    const br = opponentBetRate(id, 'person', { game: 'plo5', street: 'flop' }, null);
    expect(br && br.p > 0 && br.p < 1).toBe(true);
    expect(br!.source).toContain('public_actions');
    const r = opponentResponse(id, 'person', SPOT, {
      fold: 0.4,
      call: 0.5,
      raise: 0.1,
      n: 100,
      source: 'pop',
    });
    expect(r.fold + r.call + r.raise).toBeCloseTo(1, 6);
    expect(r.fold).toBeCloseTo(
      opponentFold(id, 'person', SPOT, { p: 0.4, n: 100, source: 'pop' }).p,
      1
    );
  });
  it('snapshot is bounded (loaded once, Map lookups only)', () => {
    expect(Object.keys(OPPONENT_MODEL_SNAPSHOT.opponents).length).toBeLessThan(5000);
    expect(JSON_TEXT.length).toBeLessThan(4_000_000);
  });
});
