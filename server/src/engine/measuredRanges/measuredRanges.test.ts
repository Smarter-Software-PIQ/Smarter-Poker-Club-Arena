import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyOmahaHolding,
  lookupRange,
  lookupResponse,
  personFoldRate,
  sizeBand,
  type MeasuredRanges,
} from './measuredRanges.js';

// Read at run time, not imported: a 4.6 MB JSON import makes tsc type the whole literal and
// pushes the server compile past the default 4 GB heap (CI native-smoke OOM on #11515).
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const FIXTURE = readJson('./classifier-parity.synthetic.fixture.json');
const TABLE = readJson('./measuredRanges.public.v3.engine.json');
const t = TABLE as unknown as MeasuredRanges;
const raw = TABLE as unknown as Record<string, unknown>;
const c = (rank: string, suit: string) => ({ rank, suit });

describe('LAW: live range tables are built from public information only', () => {
  it('declares the public-only policy and carries no table that needs unshown cards', () => {
    expect(String(raw.provenancePolicy)).toMatch(/PUBLIC INFORMATION ONLY/);
    for (const forbidden of ['realization', 'passive', 'preflopStrength'])
      expect(raw[forbidden]).toBeUndefined();
  });
  it('every range cell is showdown_only and its composition counts only shown hands', () => {
    const cells = Object.values(t.ranges);
    expect(cells.length).toBeGreaterThan(50);
    for (const cell of cells) {
      expect(cell.provenance).toBe('showdown_only');
      const shown = Object.values(cell.shownTiers).reduce((a, b) => a + (b ?? 0), 0);
      expect(shown).toBe(cell.nShown);
      expect(cell.nShown + cell.nGaveUp + cell.nWonUnshown).toBe(cell.nCalled);
      expect(cell.nCalled).toBeLessThanOrEqual(cell.n);
      for (const hidden of ['eqRandDeciles', 'meanEqVsLiveOpponents', 'made', 'draw', 'tiers'])
        expect((cell as unknown as Record<string, unknown>)[hidden]).toBeUndefined();
    }
  });
  it('ships PLO4 and PLO5 only (owner 8:26 PM)', () => {
    for (const table of [
      'ranges',
      'responses',
      'betFrequency',
      'preflop',
      'vpip',
      'preflopFacingRaise',
    ] as const)
      for (const key of Object.keys((raw[table] ?? {}) as Record<string, unknown>))
        expect(key.split('|')[0]).toMatch(/^(plo4|plo5|pooled)$/);
  });
  it('every response, bet-frequency, preflop and person row is public_actions', () => {
    for (const table of [
      'responses',
      'betFrequency',
      'preflop',
      'vpip',
      'preflopFacingRaise',
      'persons',
    ] as const) {
      const rows = Object.values((raw[table] ?? {}) as Record<string, { provenance?: string }>);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.provenance).toBe('public_actions');
    }
  });
});

describe('measured PLO ranges: classifier is the twin of the extractor', () => {
  it('matches the Python extractor on every synthetic (randomly dealt, never real) holding', () => {
    const rows = FIXTURE as Array<{
      h: { rank: string; suit: string }[];
      b: { rank: string; suit: string }[];
      made: string;
      draw: string;
      tier: string;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(600);
    for (const row of rows) {
      const got = classifyOmahaHolding(row.h, row.b);
      expect([got.made, got.draw, got.tier]).toEqual([row.made, row.draw, row.tier]);
    }
  });
  it('uses exactly two hole cards: four hearts in hand and two on board is no flush', () => {
    const r = classifyOmahaHolding(
      [c('A', 'hearts'), c('K', 'hearts'), c('Q', 'hearts'), c('J', 'hearts')],
      [c('2', 'hearts'), c('7', 'hearts'), c('9', 'clubs')]
    );
    expect(r.made).toBe('high');
    expect(r.draw).toBe('nfd');
    expect(r.value).toBe(false);
  });
  it('a board pair plus a hole pair is one pair, not two pair', () => {
    const r = classifyOmahaHolding(
      [c('K', 'spades'), c('K', 'clubs'), c('4', 'diamonds'), c('3', 'hearts')],
      [c('9', 'hearts'), c('9', 'clubs'), c('2', 'spades')]
    );
    expect(r.made).toBe('top_pair_plus');
  });
  it('bands follow the table definition', () => {
    expect(sizeBand(0.33, false)).toBe('small');
    expect(sizeBand(0.5, false)).toBe('half');
    expect(sizeBand(0.75, false)).toBe('twothirds');
    expect(sizeBand(1, false)).toBe('pot');
    expect(sizeBand(0.2, true)).toBe('allin');
  });
});

describe('measured PLO ranges: lookups back off and never throw', () => {
  it('finds a showdown_only cell for a person flop c-bet', () => {
    const hit = lookupRange(t, {
      game: 'plo5',
      mode: 'lightning',
      street: 'flop',
      line: 'cbet',
      band: 'pot',
      players: 'hu',
      opp: 'horse_present',
      bettor: 'person',
    });
    expect(hit).not.toBeNull();
    expect(hit!.cell.nShown).toBeGreaterThanOrEqual(20);
    expect(hit!.cell.nonValueShare).toBeGreaterThan(0);
    expect(hit!.cell.nonValueShare).toBeLessThan(1);
  });
  it('returns a public response cell', () => {
    const r = lookupResponse(
      t,
      {
        game: 'plo5',
        mode: 'table',
        street: 'turn',
        line: 'all',
        band: 'pot',
        players: 'hu',
        opp: 'any',
        bettor: 'horse',
      },
      'person'
    );
    expect(r).not.toBeNull();
    expect(r!.cell.fold + r!.cell.call + r!.cell.raise).toBeCloseTo(1, 2);
  });
  it('person fold rate falls back to population for an unknown user and shrinks for a known one', () => {
    expect(
      personFoldRate(
        t,
        'no-such-user',
        { game: 'plo5', street: 'flop', band: 'pot', players: 'hu', bettor: 'horse' },
        0.4
      )
    ).toEqual({ rate: 0.4, n: 0, source: 'population' });
    const one = {
      ...t,
      persons: {
        u: {
          name: null,
          nPostflopBets: 0,
          nFacingBets: 10,
          nPreflopActions: 0,
          betsByStreetLineBand: {},
          preflop: {},
          facing: {
            'plo5|flop|pot|hu|vs_horse': {
              n: 10,
              fold: 10,
              call: 0,
              raise: 0,
              popFold: 0.4,
              foldShrunk: null,
            },
          },
        },
      },
    } as MeasuredRanges;
    expect(
      personFoldRate(
        one,
        'u',
        { game: 'plo5', street: 'flop', band: 'pot', players: 'hu', bettor: 'horse' },
        0.4
      ).rate
    ).toBeCloseTo((10 + 20 * 0.4) / 30, 6);
  });
  it('a malformed table never throws', () => {
    const bad = {} as MeasuredRanges;
    expect(
      lookupRange(bad, {
        game: 'plo5',
        mode: 'table',
        street: 'flop',
        line: 'cbet',
        band: 'pot',
        players: 'hu',
        opp: 'any',
        bettor: 'person',
      })
    ).toBeNull();
    expect(
      lookupResponse(
        bad,
        {
          game: 'plo5',
          mode: 'table',
          street: 'flop',
          line: 'cbet',
          band: 'pot',
          players: 'hu',
          opp: 'any',
          bettor: 'person',
        },
        'horse'
      )
    ).toBeNull();
  });
});
