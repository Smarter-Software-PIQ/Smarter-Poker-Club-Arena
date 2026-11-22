/**
 * Lane DRAWS law tests (2026-11-19). Constructed spots only: no recorded hole
 * cards in the repository.
 */
import { describe, expect, it } from 'vitest';
import { parseCardString } from './OmahaMathCoreEval.js';
import {
  omahaDrawFeatures,
  omahaDrawFutureTerm,
  omahaBoardNuts,
  OMAHA_DRAW_PAYOFF,
} from './OmahaDraws.js';

const f = (hole: string, board: string) =>
  omahaDrawFeatures(parseCardString(hole), parseCardString(board));

describe('omahaDrawFeatures: exact Omaha outs (two hole + three board)', () => {
  it('nut flush draw + wrap is a combo draw with 13+ nut outs', () => {
    const p = f('AhKhQsJd', 'Th9h2c')!;
    expect(p.cls).toBe('NFD+wrap');
    expect(p.fd).toBe('nfd');
    expect(p.comboDraw).toBe(true);
    expect(p.nutOuts).toBeGreaterThanOrEqual(13);
    expect(p.outs).toBeGreaterThanOrEqual(p.nutOuts);
  });
  it('a 13-card wrap counts thirteen straight cards', () => {
    const p = f('JsTs8d7d', '9c6h2s')!;
    expect(p.wrapSize).toBe(13);
    expect(p.cls).toBe('wrap13-16');
  });
  it('a set with a flush redraw is set+redraw and its board-pairing outs are counted', () => {
    const p = f('KdKcQhJh', 'Kh7h2s')!;
    expect(p.made).toBe('set');
    expect(p.cls).toBe('set+redraw');
    expect(p.boatOuts).toBeGreaterThan(0);
  });
  it('only two hole cards play: four hearts in the hand on a two-heart board is a flush draw, not a flush', () => {
    const p = f('Ah5h4h3h', 'Kh9h2c')!;
    expect(p.made).toBe('high');
    expect(p.fd).toBe('nfd');
  });
  it('a non-nut flush draw: most flush outs are not nut outs (only the ace of the suit promotes it)', () => {
    const p = f('Qh8h5c4d', 'Kh7h2s')!;
    expect(p.fd).toBe('fd');
    expect(p.flushOuts).toBeGreaterThan(0);
    expect(p.nutFlushOuts).toBe(1);
    expect(p.nutFlushOuts).toBeLessThan(p.flushOuts);
  });
  it('pair + open-ender + flush draw is a pair-plus combo draw', () => {
    const p = f('9h8h7cKd', '9c6h2h')!;
    expect(p.pairPlusDraw).toBe(true);
    expect(p.comboDraw).toBe(true);
    expect(p.cls).toBe('pair+FD+SD');
  });
  it('the nuts excludes quads and straight flushes (blockers noise)', () => {
    const board = parseCardString('Qs9s5c');
    const n = omahaBoardNuts(board, parseCardString('As2s3d4d'));
    expect(Math.floor(n / 1048576)).toBeLessThan(7);
  });
  it('PLO5 is served', () => {
    expect(f('AhKhQsJd2c', 'Th9h3c')).not.toBeNull();
  });
  it('PLO6 is not touched (owner 8:27 PM): no features, no term', () => {
    const p = f('AhKhQsJd2c3d', 'Th9h4c');
    expect(p).toBeNull();
    const t = omahaDrawFutureTerm(p, {
      street: 'flop',
      potNext: 100,
      effBehind: 500,
      allIn: false,
    });
    expect(t.chips).toBe(0);
  });
});

describe('omahaDrawFutureTerm: later-street value from measured public payoff', () => {
  const ctx = { street: 'flop' as const, potNext: 100, effBehind: 400, allIn: false };
  it('a nut draw earns implied odds; a dominated draw pays reverse implied odds', () => {
    const nut = omahaDrawFutureTerm(f('AhKhQsJd', 'Th9h2c'), ctx);
    const dom = omahaDrawFutureTerm(f('Qh8h5c4d', 'Kh7h2s'), ctx);
    expect(nut.implied).toBeGreaterThan(0);
    expect(nut.chips).toBeGreaterThan(dom.chips);
    expect(dom.reverse).toBeLessThanOrEqual(0);
  });
  it('the term grows with the pot of the line (a called raise carries more later money)', () => {
    const p = f('AhKhQsJd', 'Th9h2c');
    const small = omahaDrawFutureTerm(p, { ...ctx, potNext: 60 });
    const big = omahaDrawFutureTerm(p, { ...ctx, potNext: 180 });
    expect(big.implied).toBeGreaterThan(small.implied);
  });
  it('is bounded by the stack behind and is zero all-in', () => {
    const p = f('AhKhQsJd', 'Th9h2c');
    expect(
      Math.abs(omahaDrawFutureTerm(p, { ...ctx, potNext: 100000, effBehind: 10 }).chips)
    ).toBeLessThanOrEqual(10);
    expect(omahaDrawFutureTerm(p, { ...ctx, allIn: true }).chips).toBe(0);
  });
  it('made hands and non-draws get no term (outside the measurement)', () => {
    expect(omahaDrawFutureTerm(f('KdKcQhJh', 'Kh7h2s'), ctx).chips).toBe(0);
    expect(omahaDrawFutureTerm(f('8c8d4s3s', 'KhQh2c'), ctx).chips).toBe(0);
  });
  it('a flop barrel with measured fold equity can only raise the miss branch', () => {
    const p = f('AhKhQsJd', 'Th9h2c');
    const none = omahaDrawFutureTerm(p, ctx);
    const folds = omahaDrawFutureTerm(p, {
      ...ctx,
      turnBarrelFold: { p: 0.6, source: 'test cell' },
    });
    expect(folds.miss).toBeGreaterThanOrEqual(none.miss);
    expect(folds.barrel).not.toBeNull();
  });
  it('the payoff table states its measurement', () => {
    expect(OMAHA_DRAW_PAYOFF.flop.n.hitNut).toBeGreaterThan(30);
    expect(OMAHA_DRAW_PAYOFF.source).toMatch(/public chips/);
  });
});
