// The live over-fold scoreboard (scripts/ops/horse-overfold-scoreboard*.mjs) and its place in the Horse daily audit.
// Fixtures are public actions and counts only: no hole cards anywhere.
import { describe, expect, it } from 'vitest';
import { correctedZ } from '../../scripts/ops/horse-audit-multiple-tests.mjs';
import { parseHand } from '../../scripts/ops/horse-hand-audit-omaha-lib/hand.mjs';
import {
  FLAG_Z,
  MIN_N,
  breakEven,
  facingKeyOf,
  scoreboard,
  scoreboardBets,
  scoreboardSpots,
} from '../../scripts/ops/horse-overfold-scoreboard-lib.mjs';
import {
  parseArgs,
  runScoreboard,
  scoreboardSql,
  spotsOfRows,
} from '../../scripts/ops/horse-overfold-scoreboard.mjs';
import {
  SCOREBOARD_HEADING,
  exitMeaning,
  formatSummary,
  planRuns,
  regressionsMarked,
} from '../../scripts/ops/horse-daily-audit-lib.mjs';

const P = '11111111-1111-4111-8111-111111111111'; // a person
const H = '22222222-2222-4222-8222-222222222222'; // a Horse
const H2 = '33333333-3333-4333-8333-333333333333'; // a second Horse
type Act = [number, string, string, number, string, boolean, number, number, string];
/** A PLO cash row: seats 1 (P or H2) and 2 (H), optional seat 3 (H2); actions [seat, stage, act, amt, origin, dead, pot, toCall, uid]. */
function row(
  ac: Act[],
  o: { gv?: string; three?: boolean; lightning?: boolean; firstHorse?: boolean; id?: string } = {}
) {
  const first = o.firstHorse ? H2 : P;
  const pl = [
    [1, first, 500, null, o.firstHorse === true, true],
    [2, H, 500, null, true, true],
  ];
  if (o.three) pl.push([3, H2, 500, null, true, true]);
  return {
    id: o.id ?? '44444444-4444-4444-8444-444444444444',
    created_at: '2026-11-27 12:00:00+00',
    gv: o.gv ?? 'plo5',
    bb: 2,
    btn: 2,
    pot: 100,
    bomb: false,
    cc2: null,
    mtt: false,
    build: '3aa21caa9f7d',
    lightning: o.lightning === true,
    pl,
    ac,
  };
}
const hand = (r: ReturnType<typeof row>) => {
  const h = parseHand(r) as ReturnType<typeof parseHand> & { mtt?: boolean; venue?: string };
  h.mtt = false;
  h.venue = r.lightning ? 'lightning' : 'table';
  return h;
};
const pA = (u: string) => (u === H || u === H2 ? 'horse_policy' : 'player');
const seatOf = (u: string) => (u === H ? 2 : u === H2 ? 3 : 1);
const a = (
  u: string,
  street: string,
  act: string,
  amt: number,
  pot: number,
  toCall: number
): Act => [seatOf(u), street, act, amt, pA(u), false, pot, toCall, u];

describe('scoreboard spots: what a Horse faces', () => {
  it("a person's first bet heads-up: kind bet, s = added / pot, break-even s/(1+s), bettor person", () => {
    const s = scoreboardSpots(
      hand(row([a(P, 'turn', 'bet', 75, 100, 0), a(H, 'turn', 'fold', 0, 175, 75)]))
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      who: 'horse',
      bettor: 'person',
      kind: 'bet',
      facing: 'b0.7-1.1',
      players: 'hu',
      fold: true,
      venue: 'table',
    });
    expect(s[0]!.s).toBeCloseTo(0.75, 12);
    expect(s[0]!.be).toBeCloseTo(0.75 / 1.75, 12);
  });
  it("a check-raise and a raise are told apart and priced on the raiser's added chips", () => {
    const cr = scoreboardSpots(
      hand(
        row([
          a(P, 'flop', 'check', 0, 100, 0),
          a(H, 'flop', 'bet', 50, 100, 0),
          a(P, 'flop', 'raise', 200, 150, 50),
          a(H, 'flop', 'fold', 0, 350, 150),
        ])
      )
    ).filter((x) => x.who === 'horse');
    expect(cr).toHaveLength(1);
    expect(cr[0]).toMatchObject({ kind: 'check-raise', facing: 'check-raise', bettor: 'person' });
    expect(cr[0]!.s).toBeCloseTo(200 / 150, 12);
    const rr = scoreboardSpots(
      hand(
        row([
          a(P, 'river', 'bet', 50, 100, 0),
          a(H, 'river', 'raise', 150, 150, 50),
          a(P, 'river', 'raise', 450, 300, 100),
          a(H, 'river', 'call', 450, 750, 300),
        ])
      )
    ).filter((x) => x.who === 'horse');
    expect(rr).toHaveLength(2); // facing the bet (a call-free raise is still a decision facing a bet) and the re-raise
    expect(rr[0]).toMatchObject({ kind: 'bet', fold: false });
    expect(rr[1]).toMatchObject({ kind: 'raise', facing: 'raise', fold: false });
    expect(rr[1]!.s).toBeCloseTo(400 / 300, 12);
  });
  it('a Horse bettor, multiway, sizes, Lightning, and a person deciding (people own folds)', () => {
    const hh = scoreboardSpots(
      hand(
        row([a(H2, 'turn', 'bet', 30, 100, 0), a(H, 'turn', 'fold', 0, 130, 30)], {
          firstHorse: true,
          lightning: true,
        })
      )
    );
    expect(hh[0]).toMatchObject({
      bettor: 'horse',
      who: 'horse',
      facing: 'b<0.4',
      venue: 'lightning',
    });
    const mw = scoreboardSpots(
      hand(
        row(
          [
            a(P, 'flop', 'bet', 120, 100, 0),
            a(H, 'flop', 'fold', 0, 220, 120),
            a(H2, 'flop', 'call', 120, 220, 120),
          ],
          { three: true }
        )
      )
    );
    expect(mw[0]).toMatchObject({ players: '3way', opponents: 2, facing: 'b1.1+' });
    expect(mw[0]!.be).toBeCloseTo(breakEven(1.2, 2), 12);
    const ppl = scoreboardSpots(
      hand(row([a(H, 'turn', 'bet', 50, 100, 0), a(P, 'turn', 'fold', 0, 150, 50)]))
    );
    expect(ppl[0]).toMatchObject({ who: 'person', bettor: 'horse' });
    expect(facingKeyOf('bet', 0.4)).toBe('b0.4-0.7');
    expect(facingKeyOf('bet', 1.1)).toBe('b1.1+');
  });
  it('leaves out preflop, a person on Horse policy, an unknown seat and other games', () => {
    expect(
      scoreboardSpots(
        hand(row([a(P, 'preflop', 'raise', 6, 3, 0), a(H, 'preflop', 'fold', 0, 9, 4)]))
      )
    ).toEqual([]);
    const pol: Act = [1, 'turn', 'bet', 75, 'horse_policy', false, 100, 0, P];
    expect(scoreboardSpots(hand(row([pol, a(H, 'turn', 'fold', 0, 175, 75)])))).toEqual([]);
    const r = row([a(P, 'turn', 'bet', 75, 100, 0), a(H, 'turn', 'fold', 0, 175, 75)]);
    expect(scoreboardSpots(hand(r), { known: new Set([H]) })).toEqual([]);
    expect(
      scoreboardSpots(
        hand(
          row([a(P, 'turn', 'bet', 75, 100, 0), a(H, 'turn', 'fold', 0, 175, 75)], { gv: 'plo6' })
        )
      )
    ).toEqual([]);
  });
  it('fold-through: a bet into Horses only that every Horse folds, with the zero-equity bluff value in bb', () => {
    const b = scoreboardBets(
      hand(row([a(P, 'river', 'bet', 50, 100, 0), a(H, 'river', 'fold', 0, 150, 50)]))
    );
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({
      through: true,
      bettor: 'person',
      players: 'hu',
      facing: 'b0.4-0.7',
    });
    expect(b[0]!.bluffBb).toBeCloseTo(50, 12);
    const c = scoreboardBets(
      hand(row([a(P, 'river', 'bet', 50, 100, 0), a(H, 'river', 'call', 50, 150, 50)]))
    );
    expect(c[0]).toMatchObject({ through: false });
    expect(c[0]!.bluffBb).toBeCloseTo(-25, 12);
    // a Horse's bet into a person is not a bet into a Horse-only field
    expect(
      scoreboardBets(
        hand(row([a(H, 'river', 'bet', 50, 100, 0), a(P, 'river', 'fold', 0, 150, 50)]))
      )
    ).toEqual([]);
  });
});

type Spot = Record<string, unknown>;
const spots = (n: number, folds: number, o: Spot = {}): Spot[] =>
  Array.from({ length: n }, (_, i) => ({
    gv: 'plo5',
    venue: 'table',
    street: 'turn',
    players: 'hu',
    opponents: 1,
    facing: 'b0.7-1.1',
    kind: 'bet',
    s: 0.75,
    be: 0.75 / 1.75,
    bettor: 'person',
    who: 'horse',
    oop: i % 2 === 0,
    fold: i < folds,
    ...o,
  }));
const OWNER = {
  owners: [
    {
      option: 'omahaFacingBetPriorIsPeopleMeasured',
      games: ['plo4', 'plo5'],
      streets: ['turn', 'river'],
      fields: ['hu'],
      sizes: ['small', 'mid', 'large'],
    },
  ],
};

describe('the board', () => {
  it('a Horse-only board never gates (exit 2) but flags a cell where a pure bluff prints', () => {
    const sb = scoreboard({ spots: spots(100, 80, { bettor: 'horse' }) });
    expect(sb.exitCode).toBe(2);
    const c = sb.cells.find((x) => x.venue === 'table')!;
    expect(c).toMatchObject({ n: 100, folds: 80, flag: 'OVER', overBe: true, gating: false });
    expect(sb.cells.find((x) => x.venue === 'all')!.n).toBe(100);
  });
  it('a person cell over break-even gates at the corrected bar; with its owner ON it is breach-class', () => {
    const sb = scoreboard({
      spots: spots(100, 80),
      ownerMap: OWNER,
      switches: {
        omahaFacingBetPriorIsPeopleMeasured: { state: 'on', since: '2026-11-27T08:39:43Z' },
      },
      sinceMs: Date.parse('2026-11-27T09:00:00Z'),
    });
    expect(sb.exitCode).toBe(1);
    expect(sb.zBar).toBeCloseTo(correctedZ(FLAG_Z, sb.personTests), 12);
    expect(sb.gating).toHaveLength(1);
    expect(sb.gating[0]).toMatchObject({ breachClass: true, venue: 'table' });
    expect(sb.lines[0]).toMatch(
      /^BREACH-CLASS \(scoreboard, fix ON\): PLO5 table turn heads-up facing a person's bet 0.7-1.1 pot/
    );
  });
  it('a cell under MIN_N is shown, never flagged; at break-even it is clean', () => {
    const few = scoreboard({ spots: spots(MIN_N - 1, MIN_N - 1) });
    expect(few.cells[0]!.flag).toBe(`n < ${MIN_N}`);
    expect(few.exitCode).toBe(2);
    const ok = scoreboard({ spots: spots(100, 43) });
    expect(ok.exitCode).toBe(0);
    expect(ok.cells[0]!.flag).toBe('clean');
  });
  it("people's own fold share is the ceiling with 30 people decisions in the cell", () => {
    const people = spots(40, 10, { who: 'person', bettor: 'horse' });
    const sb = scoreboard({ spots: spots(60, 30, { bettor: 'horse' }), people });
    const c = sb.cells.find((x) => x.venue === 'table')!;
    expect(c.peopleTier).toBe('people-own');
    expect(c.peopleCeiling).toBeCloseTo(0.25, 12);
    expect(c.overPeople).toBe(true);
    expect(
      scoreboard({ spots: spots(60, 30), people: people.slice(0, 29) }).cells[0]!.peopleTier
    ).toBe('none');
  });
});

describe('the read and the CLI', () => {
  it('selects no hole-card, showdown or winner column; filters build and people', () => {
    const sql = scoreboardSql({ from: 0, to: 3600_000 });
    expect(sql).not.toMatch(/hole_cards|showdown|winners|h\.board/);
    expect(sql).toContain('lightning_hand');
    expect(sql).not.toContain('has_human');
    expect(scoreboardSql({ from: 0, to: 1, build: '3aa21caa' })).toContain(
      "engine_build like '3aa21caa%'"
    );
    expect(scoreboardSql({ from: 0, to: 1, people: true })).toContain('h.has_human = true');
    expect(() => scoreboardSql({ from: 0, to: 1, build: "x'; drop" })).toThrow();
    expect(() => parseArgs(['--build', 'nothex!'])).toThrow();
    expect(parseArgs(['--since', '2026-11-27T08:39:43Z', '--people-days', '0']).peopleDays).toBe(0);
  });
  it('runs end to end on given rows: Lightning split, builds counted, exit 2 on a Horse-only range', () => {
    const r1 = row([a(H2, 'turn', 'bet', 75, 100, 0), a(H, 'turn', 'fold', 0, 175, 75)], {
      firstHorse: true,
      lightning: true,
    });
    const r2 = {
      ...row([a(P, 'turn', 'bet', 75, 100, 0), a(H, 'turn', 'fold', 0, 175, 75)]),
      id: '55555555-5555-4555-8555-555555555555',
    };
    const { spots: sp, builds } = spotsOfRows([r1, r2], []);
    expect(sp.map((x) => `${x.venue}:${x.bettor}`).sort()).toEqual([
      'lightning:horse',
      'table:person',
    ]);
    expect(builds['plo5 lightning 3aa21caa9f7d']).toBe(1);
    const out: string[] = [];
    const code = runScoreboard(
      ['--since', '2026-11-27T08:00:00Z', '--until', '2026-11-27T13:00:00Z', '--json'],
      {
        query: (sql: string) =>
          sql.includes('ca_horse_style_switch') ? [] : sql.includes('has_human') ? [] : [r1],
        stdout: (s: string) => out.push(s),
        stderr: () => {},
        ownerMap: OWNER,
        prior: null,
      }
    );
    expect(code).toBe(2);
    const j = JSON.parse(out.join('\n'));
    expect(j.horseSpots).toBe(1);
    expect(j.cells.some((c: { venue: string }) => c.venue === 'lightning')).toBe(true);
  });
});

describe('the daily audit runs it', () => {
  const S = Date.parse('2026-11-27T00:00:00Z');
  const U = S + 86400_000;
  it('plans the run, names its exit codes, lists raise/check-raise/Lightning person findings and a summary section', () => {
    const run = planRuns(S, U, []).find((r) => r.name === 'overfold-scoreboard')!;
    expect(run.script).toBe('horse-overfold-scoreboard.mjs');
    expect(run.args).toContain('--json');
    expect(exitMeaning('overfold-scoreboard', 2)).toMatch(/Horse-only/);
    const sb = scoreboard({
      spots: [
        ...spots(100, 90, { facing: 'raise', kind: 'raise', s: 1, be: 0.5 }),
        ...spots(100, 90),
      ],
    });
    const res = {
      'overfold-scoreboard': {
        code: sb.exitCode,
        json: { ...sb, spots: 200, personSpots: 200, horseSpots: 0, hands: 200 },
      },
    };
    const m = regressionsMarked(res);
    // the raise cell is the scoreboard's; the table first-bet cell is the alarm's (not listed twice)
    expect(m.count).toBe(1);
    expect(m.lines[0]).toMatch(/^scoreboard: PLO5 table turn heads-up facing a person's raise/);
    const md = formatSummary({
      sinceMs: S,
      untilMs: U,
      plan: { splits: [], leftOut: [] },
      runs: planRuns(S, U, []),
      results: res,
      folder: 'x',
    });
    expect(md).toContain(SCOREBOARD_HEADING);
    expect(md).toContain('Cells flagged OVER at 2 SE (per venue): facing a person 2');
  });
});
