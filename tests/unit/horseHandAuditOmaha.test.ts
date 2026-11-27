import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from '../../scripts/ops/holdem-blanket-scoreboard-lib.mjs';
import {
  category,
  comboDrawForRaise,
  drawForRaiseBar,
  eval5,
  holdingPool,
  boatsAbove,
  isNutsExact,
  nutClass,
  omaha,
  parseCard,
  rangeEquity,
  rng,
} from '../../scripts/ops/horse-hand-audit-omaha-lib/omaha.mjs';
import { auditSql } from '../../scripts/ops/horse-hand-audit-omaha-lib/sql.mjs';
import { parseHand, shownCards } from '../../scripts/ops/horse-hand-audit-omaha-lib/hand.mjs';
import { nodeFoldCost } from '../../scripts/ops/horse-hand-audit-omaha-lib/rangetier.mjs';
import { mistakeClass } from '../../scripts/ops/horse-hand-audit-omaha-lib/grade.mjs';
import { omahaNutClassNow } from '../../server/src/engine/HorseOmahaMadeHandDefense';
import {
  omahaComboDrawForRaise,
  omahaDrawRaiseBar,
} from '../../server/src/engine/HorseOmahaBigDrawAggression';
import { aggregate } from '../../scripts/ops/horse-hand-audit-omaha-lib/aggregate.mjs';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_TOO_FEW,
  EXIT_USAGE,
  EXIT_WORSE,
  buildAudit,
  exitCodeFor,
  runCli,
} from '../../scripts/ops/horse-hand-audit-omaha.mjs';

const FIXTURE = resolve(__dirname, '../fixtures/horse-hand-audit-omaha/hands.json');
const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const tables = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../scripts/ops/horse-hand-audit-omaha-lib/range-tables.json'),
    'utf8'
  )
);
const C = (s: string) =>
  s
    .split(' ')
    .map((x) =>
      parseCard(
        x.slice(0, -1) + { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[x.slice(-1) as 's']
      )
    );
const FAST = { M: 400, N: 600, seed: 7 };

describe('Omaha evaluator', () => {
  it('ranks the categories and the wheel', () => {
    expect(
      category(eval5(...(C('As Ks Qs Js Ts') as [number, number, number, number, number])))
    ).toBe(8);
    expect(
      category(eval5(...(C('5s 4d 3c 2h Ah') as [number, number, number, number, number])))
    ).toBe(4);
    expect(
      eval5(...(C('6s 5d 4c 3h 2h') as [number, number, number, number, number]))
    ).toBeGreaterThan(eval5(...(C('5s 4d 3c 2h Ah') as [number, number, number, number, number])));
    expect(
      eval5(...(C('As Ad Kc Kh 2d') as [number, number, number, number, number]))
    ).toBeGreaterThan(eval5(...(C('As Ad Qc Qh Kd') as [number, number, number, number, number])));
  });
  it('uses exactly two hole cards and three board cards', () => {
    expect(category(omaha(C('Ah Kd 2s 3c'), C('9s 8s 7s 4s Jd')))).not.toBe(5);
    expect(category(omaha(C('Ah Ks 2s 3c'), C('9s 8s 7d 4s Jd')))).toBe(5);
    expect(category(omaha(C('Ah Kd 2c 3c'), C('9s 9h 9d 9c Jd')))).toBeLessThan(7);
  });
  it('knows the nuts and gives seeded, sane equity', () => {
    expect(isNutsExact(C('Ah Kh 2c 3d'), C('Qh Jh Th 2s 5d'))).toBe(true);
    expect(isNutsExact(C('Ac Kd 2c 3d'), C('Qh Jh Th 2s 5d'))).toBe(false);
    const hero = C('As Ah Kd Kc');
    const run = () => {
      const r = rng(1);
      const pool = holdingPool(hero, 4, 300, r);
      return rangeEquity(hero, [], [{ weights: pool.map(() => 1) }], pool, 2000, r)!.eq;
    };
    const e = run();
    expect(e).toBeGreaterThan(0.6);
    expect(e).toBeLessThan(0.73);
    expect(run()).toBe(e);
  });
});

describe('shown cards only', () => {
  it('selects hole cards only through the showdown list, skipping mucked entries', () => {
    const sql = auditSql({ from: '2026-11-23T00:00:00Z', to: '2026-11-23T06:00:00Z' });
    expect(() => assertReadOnlySql(sql)).not.toThrow();
    const hc = sql.slice(
      sql.indexOf("(select jsonb_object_agg(s->>'user_id', h.hole_cards"),
      sql.indexOf('from hand_history h')
    );
    expect(hc).toContain("coalesce((s->>'mucked')::boolean, false) = false");
    expect(hc).toContain('h.showdown');
    // every mention of hole_cards sits inside that showdown-filtered column
    const all = sql.split('hole_cards').length - 1;
    const inside = hc.split('hole_cards').length - 1;
    expect(all).toBe(inside);
    expect(all).toBeGreaterThan(0);
    // winner rows are selected without their hand cards
    expect(sql).not.toMatch(/h\.winners w,/);
    expect(sql).toContain(
      "jsonb_build_object('userId', w->>'userId', 'amount', w->'amount', 'potIndex', w->'potIndex')"
    );
  });
  it('the parser ignores cards of a mucked or unlisted player even if a row carries them', () => {
    const third = rows[2];
    expect(shownCards(third).has('h1')).toBe(false);
    expect(shownCards(third).has('p1')).toBe(true);
    expect(shownCards({ ...rows[0], sd: [] }).size).toBe(0);
  });
});

describe('grading from saved hands', () => {
  const out = buildAudit(rows, { tables, opts: FAST });
  const river = (id: string) =>
    out.decisions.find(
      (d: { hand_id: string; street: string }) => d.hand_id === id && d.street === 'river'
    );
  it('reconciles money and keeps every hand', () => {
    expect(out.summary.hands).toBe(3);
    for (const r of rows) {
      const h = parseHand(r);
      expect(h.players.reduce((s: number, p: { inv: number }) => s + p.inv, 0)).toBeCloseTo(6, 6);
    }
  });
  it('a river call with the nuts is not a mistake', () => {
    const d = river('00000000-0000-4000-8000-000000000001');
    expect(d.tier).toBe('A');
    expect(d.act_taken).toBe('call');
    expect(d.ev_taken_bb).toBeGreaterThan(0);
    expect(d.mtype === 'called too light' || d.mtype === 'paid off (river call)').toBe(false);
  });
  it('a river call with nine high against a pot bet is a HARD mistake with a cost', () => {
    const d = river('00000000-0000-4000-8000-000000000002');
    expect(d.tier).toBe('A');
    expect(d.verdict).toBe('MISTAKE');
    expect(d.mclass).toBe('HARD');
    expect(['called too light', 'paid off (river call)']).toContain(d.mtype);
    expect(d.cost_bb).toBeGreaterThan(0.5);
    expect(d.hind_cost_bb).toBeGreaterThan(0);
  });
  it('a mucked Horse is graded only in the range tier', () => {
    const ds = out.decisions.filter(
      (d: { hand_id: string }) => d.hand_id === '00000000-0000-4000-8000-000000000003'
    );
    expect(ds.length).toBeGreaterThan(0);
    expect(ds.every((d: { tier: string }) => d.tier === 'B')).toBe(true);
  });
  it('model-dependent gaps are OPPORTUNITY, not chips lost', () => {
    expect(mistakeClass('missed bet (fold equity)', 'flop', { eqc: 0.9 })).toBe('OPPORTUNITY');
    expect(mistakeClass('missed value bet', 'river', { eqc: 0.6 }, true)).toBe('OPPORTUNITY');
    expect(mistakeClass('missed value bet', 'river', { eqc: 0.6 }, false)).toBe('HARD');
    expect(mistakeClass('called too light', 'river', { eqc: 0 })).toBe('HARD');
  });
});

describe('range tier fold cost', () => {
  const edges = tables.binEdges;
  it('folding against a pure value range costs nothing', () => {
    const nuts = edges.slice(0, -1).map((_: number, i: number) => (i === 0 ? 1 : 0));
    expect(nodeFoldCost({ bettorHist: nuts, edges, s: 0.5, xc: 0.3 }).over).toBe(0);
  });
  it('folding against a range of air costs chips; a high fold rate alone does not', () => {
    const air = edges
      .slice(0, -1)
      .map((_: number, i: number, a: number[]) => (i === a.length - 1 ? 1 : 0));
    expect(nodeFoldCost({ bettorHist: air, edges, s: 0.5, xc: 0.3 }).over).toBeGreaterThan(0.1);
    const value = edges.slice(0, -1).map((_: number, i: number) => (i < 3 ? 1 / 3 : 0));
    expect(nodeFoldCost({ bettorHist: value, edges, s: 1, xc: 0.2 }).over).toBe(0);
  });
});

describe('exit codes', () => {
  const quiet = { stdout: () => undefined, stderr: () => undefined, opts: FAST };
  const range = ['--since', '2026-11-23T00:00:00Z', '--until', '2026-11-24T00:00:00Z'];
  it('2 when there are too few hands, 0 otherwise', () => {
    expect(runCli(['--from-json', FIXTURE, ...range, '--min-hands', '10'], quiet)).toBe(
      EXIT_TOO_FEW
    );
    expect(runCli(['--from-json', FIXTURE, ...range, '--min-hands', '1', '--json'], quiet)).toBe(
      EXIT_OK
    );
  });
  it('64 for usage errors and 70 for failures', () => {
    expect(runCli(['--bogus'], quiet)).toBe(EXIT_USAGE);
    expect(runCli([...range, '--split-at', '2026-12-01T00:00:00Z'], quiet)).toBe(EXIT_USAGE);
    expect(
      runCli(['--since', '2026-11-01T00:00:00Z', '--until', '2026-11-24T00:00:00Z'], quiet)
    ).toBe(EXIT_USAGE);
    expect(runCli(['--from-json', '/nonexistent/file.json', ...range], quiet)).toBe(EXIT_FAILED);
  });
  it('1 when a HARD leak versus people got worse after the split', () => {
    const mk = (time: string) => ({
      hand_id: 'x',
      time,
      tier: 'A',
      verdict: 'MISTAKE',
      mclass: 'HARD',
      mtype: 'called too light',
      street: 'river',
      opp_person: 'y',
      cost_bb: 10,
      pos: 'IP',
      into: 'hu',
      act_taken: 'call',
    });
    const hands = [
      {
        hand_id: 'a',
        time: '2026-11-23T01:00:00Z',
        n_people: 50,
        perPerson: [],
        day: 'd',
        game: 'plo5',
      },
      {
        hand_id: 'b',
        time: '2026-11-23T20:00:00Z',
        n_people: 50,
        perPerson: [],
        day: 'd',
        game: 'plo5',
      },
    ];
    const decisions = Array.from({ length: 6 }, () => mk('2026-11-23T21:00:00Z'));
    const s = aggregate({ hands, decisions, nodes: [], splitAt: '2026-11-23T12:00:00Z' });
    expect(s.split.worse.length).toBe(1);
    expect(exitCodeFor(s, 1)).toBe(EXIT_WORSE);
    expect(
      exitCodeFor(
        aggregate({ hands, decisions: [], nodes: [], splitAt: '2026-11-23T12:00:00Z' }),
        1
      )
    ).toBe(EXIT_OK);
  });
});

describe('owner rule "a hand that is not nut class never raises the turn or river": the audit asks the engine\'s question', () => {
  // Hand shapes only. The Horse's own cards are the ones the hand showed where they matter to the shape (T-T on
  // 8-T-8-3); the side cards are fillers that play no part, and no opponent card is in any fixture (the opponent
  // is recorded as not shown).
  const card = (x: string) => ({
    rank: x.slice(0, -1),
    suit: { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[x.slice(-1) as 's'],
  });
  const H = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const P = 'bbbbbbbb-0000-4000-8000-00000000000b';

  it('tens full on 8-T-8-3 is nut class though quad eights are possible (hand 0bf48e08); an under-full is not', () => {
    const board = C('8c Td 8d 3s');
    const topBoat = C('Th Ts 2c 5h 9h');
    expect(isNutsExact(topBoat, board)).toBe(false);
    expect(boatsAbove(topBoat, board)).toBe(0);
    expect(nutClass(topBoat, board)).toBe('effective');
    // threes full of eights: T-T and T-8 make a bigger full house
    expect(boatsAbove(C('3h 3c 2c 5h 9h'), board)).toBeGreaterThan(0);
    expect(nutClass(C('3h 3c 2c 5h 9h'), board)).toBeNull();
    // quad eights: the exact nuts
    expect(nutClass(C('8h 8s 2c 5h'), board)).toBe('nuts');
  });
  it('the nut flush and the nut straight are nut class only on the boards the engine names', () => {
    // nut flush, unpaired board, a straight flush possible: not the exact nuts, still nut class
    expect(isNutsExact(C('Ah Kh 2c 3d'), C('9h 8h 7h 2s'))).toBe(false);
    expect(nutClass(C('Ah Kh 2c 3d'), C('9h 8h 7h 2s'))).toBe('effective');
    // nut flush on a paired board: a full house is possible, not nut class
    expect(nutClass(C('Ah Kh 2c 3d'), C('9h 8h 7h 9s'))).toBeNull();
    // second-nut flush
    expect(nutClass(C('Kh Qh 2c 3d'), C('9h 8h 4h 2s'))).toBeNull();
    // nut straight with a flush possible / with no flush possible
    expect(nutClass(C('Jc Td 2c 3d'), C('9h 8h 7h 2s'))).toBeNull();
    expect(nutClass(C('Jc Td 2c 3d'), C('9h 8s 7d 2s'))).toBe('nuts');
    // a set is not nut class once a straight is possible
    expect(nutClass(C('9c 9d 2c 3d'), C('9h 8s 7d 2s'))).toBeNull();
  });
  it('agrees with the engine (omahaNutClassNow) on 400 seeded turn and river holdings of four and five cards', () => {
    const r = rng(20261126);
    const names = (cs: number[]) =>
      cs.map((c) => ({
        rank: '23456789TJQKA'[c >> 2],
        suit: ['clubs', 'diamonds', 'hearts', 'spades'][c & 3],
      }));
    let n = 0;
    let effective = 0;
    for (let i = 0; i < 400; i++) {
      const deck = Array.from({ length: 52 }, (_, k) => k);
      for (let k = 51; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [deck[k], deck[j]] = [deck[j]!, deck[k]!];
      }
      // half the boards are forced to be paired or three of a suit, where the classes differ from the exact nuts
      if (i % 2 === 0) deck[1] = ((deck[0]! >> 2) << 2) | ((deck[0]! + 1) & 3);
      const uniq = [...new Set(deck)];
      const nb = i % 4 < 2 ? 4 : 5;
      const nh = i % 3 === 0 ? 5 : 4;
      const board = uniq.slice(0, nb);
      const hole = uniq.slice(nb, nb + nh);
      const engine = omahaNutClassNow(
        { cards: names(hole) } as never,
        {
          stage: nb === 4 ? 'turn' : 'river',
          gameVariant: nh === 5 ? 'plo5' : 'plo4',
          communityCards: names(board),
        } as never
      );
      const mine = nutClass(hole, board);
      expect(mine !== null, `${hole} on ${board}`).toBe(engine);
      n++;
      if (mine === 'effective') effective++;
    }
    expect(n).toBe(400);
    expect(effective).toBeGreaterThan(0);
  });

  const turnRaise = (holeCards: string[]) => ({
    id: '0bf48e08-0000-4000-8000-000000000001',
    created_at: '2026-11-25 22:34:34.000000+00',
    gv: 'plo5',
    bb: '1.00',
    btn: '1',
    build: 'd07cd7d7feec',
    hh: true,
    rake: '0',
    bbj: '0',
    pot: '65.00',
    tid: 't1',
    cc: ['8clubs', 'Tdiamonds', '8diamonds', '3spades', '2hearts'],
    cc2: null,
    rit: null,
    bomb: false,
    pl: [
      [1, P, 67.5, 'ShapePerson', false],
      [2, H, 132.5, 'ShapeHorse', true],
    ],
    ac: [
      [1, 'preflop', 'sb', 0.5, 'forced', false, null, null, P],
      [2, 'preflop', 'bb', 1, 'forced', false, null, null, H],
      [1, 'preflop', 'raise', 3, 'human', null, null, null, P],
      [2, 'preflop', 'call', 2, 'horse_policy', null, null, null, H],
      [2, 'flop', 'check', 0, 'horse_policy', null, null, null, H],
      [1, 'flop', 'bet', 5.5, 'human', null, null, null, P],
      [2, 'flop', 'call', 5.5, 'horse_policy', null, null, null, H],
      [2, 'turn', 'check', 0, 'horse_policy', null, null, null, H],
      [1, 'turn', 'bet', 7, 'human', null, null, null, P],
      [2, 'turn', 'raise', 24, 'horse_policy', null, null, null, H],
      [1, 'turn', 'call', 17, 'human', null, null, null, P],
      [2, 'river', 'check', 0, 'horse_policy', null, null, null, H],
      [1, 'river', 'check', 0, 'human', null, null, null, P],
    ],
    w: [{ userId: H, amount: 65, potIndex: 0 }],
    pots: [{ amount: 65, eligible: [H, P] }],
    sd: [
      [1, P, true],
      [2, H, false],
    ],
    hc: { [H]: holeCards.map(card) },
  });
  const raiseRow = (row: unknown) =>
    buildAudit([row], { tables, opts: FAST }).decisions.find(
      (d: { street: string; act_taken?: string; tier: string }) =>
        d.street === 'turn' && d.tier === 'A' && d.act_taken === 'raise'
    );

  it('the turn check-raise with tens full on 8-T-8-3 is no breach; it is counted apart as nut class, not the exact nuts', () => {
    const out = buildAudit([turnRaise(['Th', 'Ts', '2c', '5h', '9h'])], { tables, opts: FAST });
    const d = raiseRow(turnRaise(['Th', 'Ts', '2c', '5h', '9h']));
    expect(d).toBeTruthy();
    expect(d.nuts).toBe(false);
    expect(d.nut_class).toBe('effective');
    expect(d.breach).toBe('');
    expect(d.note).toBe('nut-class raise turn/river, not the exact nuts');
    expect(d.mtype).not.toBe('raised a non-nut hand on turn/river');
    expect(out.summary.breaches).toEqual([]);
    expect(out.summary.notes).toMatchObject([
      { note: 'nut-class raise turn/river, not the exact nuts', n: 1, vsPerson: 1 },
    ]);
  });
  it('the same raise with an under-full is still the breach, and lists every hand', () => {
    const row = turnRaise(['3h', '3c', '2c', '5h', '9h']);
    const d = raiseRow(row);
    expect(d.nut_class).toBe('');
    expect(d.breach).toBe('non-nut raise turn/river');
    const out = buildAudit([row], { tables, opts: FAST });
    expect(out.summary.breaches).toMatchObject([
      { breach: 'non-nut raise turn/river', n: 1, hands: ['0bf48e08-0000-4000-8000-000000000001'] },
    ]);
  });

  /** Hand 9fb142d2 shape: the person moves all in on the flop; the Horse covers and answers all in; the rest returns. */
  const allInOverAllIn = (personStack: number) => {
    const horseIn = Math.min(500, personStack);
    return {
      id: '9fb142d2-0000-4000-8000-000000000002',
      created_at: '2026-11-25 20:00:00.000000+00',
      gv: 'plo4',
      bb: '1.00',
      btn: '2',
      build: 'd07cd7d7feec',
      hh: true,
      rake: '0',
      bbj: '0',
      pot: String(2 * horseIn),
      tid: 't1',
      cc: ['Kdiamonds', '9spades', '4clubs', '2hearts', '7diamonds'],
      cc2: null,
      rit: null,
      bomb: false,
      pl: [
        [1, P, personStack - horseIn, 'ShapePerson', false],
        [2, H, 500 + horseIn, 'ShapeHorse', true],
      ],
      ac: [
        [2, 'preflop', 'sb', 0.5, 'forced', false, null, null, H],
        [1, 'preflop', 'bb', 1, 'forced', false, null, null, P],
        [2, 'preflop', 'raise', 3, 'horse_policy', null, null, null, H],
        [1, 'preflop', 'call', 2, 'human', null, null, null, P],
        [1, 'flop', personStack <= 500 ? 'all_in' : 'bet', 181, 'human', null, null, null, P],
        [2, 'flop', 'all_in', 497, 'horse_policy', null, null, null, H],
        ...(personStack <= 500
          ? [[2, 'flop', 'return', 497 - (personStack - 3), 'system', null, null, null, H]]
          : [[1, 'flop', 'call', 316, 'human', null, null, null, P]]),
      ],
      w: [{ userId: H, amount: 2 * horseIn, potIndex: 0 }],
      pots: [{ amount: 2 * horseIn, eligible: [H, P] }],
      sd: [
        [1, P, true],
        [2, H, false],
      ],
      hc: { [H]: ['Kh', 'Ks', '5c', '6d'].map(card) },
    };
  };
  const flopAnswer = (row: unknown) =>
    buildAudit([row], { tables, opts: FAST }).decisions.find(
      (d: { street: string; tier: string; origin: string }) =>
        d.street === 'flop' && d.tier === 'A' && d.origin === 'horse_policy'
    );
  it('an all-in over a sole opponent who is already all in is graded as the call it is (hand 9fb142d2)', () => {
    const d = flopAnswer(allInOverAllIn(184));
    expect(d).toBeTruthy();
    expect(d.act_taken).toBe('call');
    expect(d.taken).toBe('call');
    expect(d.mtype).not.toBe('raise without price');
    expect(d.breach).toBe('');
  });
  it('the same all-in over an opponent with chips behind is still a raise', () => {
    const d = flopAnswer(allInOverAllIn(1000));
    expect(d.act_taken).toBe('raise');
    expect(d.taken).toBe('raise(taken)');
  });

  /** Hand 13456d61 shape (PLO5, Lightning, build 3aa21caa): the Horse's own shown cards Qh Tc 4d Kc Ad on
   * 7d 9s Js 2d (nut flush draw with a nine-out wrap, no pair); the opponent bets the turn and the Horse raises.
   * ip true: the Horse has the button (acts last after the flop); ip false: the same cards out of position. */
  const comboTurnRaise = (ip: boolean) => {
    const A = ip ? H : P; // the button: small blind preflop, last to act after the flop
    const B = ip ? P : H;
    const o = (u: string) => (u === H ? 'horse_policy' : 'human');
    return {
      id: '13456d61-0000-4000-8000-00000000000' + (ip ? '3' : '4'),
      created_at: '2026-11-27 16:09:12.000000+00',
      gv: 'plo5',
      bb: '1.00',
      btn: '1',
      build: '3aa21caa9f7d',
      hh: true,
      rake: '0',
      bbj: '0',
      pot: '144.00',
      tid: 't1',
      cc: ['7diamonds', '9spades', 'Jspades', '2diamonds', '3spades'],
      cc2: null,
      rit: null,
      bomb: false,
      pl: [
        [1, A, 200, A === H ? 'ShapeHorse' : 'ShapePerson', A === H],
        [2, B, 200, B === H ? 'ShapeHorse' : 'ShapePerson', B === H],
      ],
      ac: [
        [1, 'preflop', 'sb', 0.5, 'forced', false, null, null, A],
        [2, 'preflop', 'bb', 1, 'forced', false, null, null, B],
        [1, 'preflop', 'raise', 3, o(A), null, null, null, A],
        [2, 'preflop', 'call', 2, o(B), null, null, null, B],
        [2, 'flop', 'check', 0, o(B), null, null, null, B],
        [1, 'flop', 'bet', 5, o(A), null, null, null, A],
        [2, 'flop', 'call', 5, o(B), null, null, null, B],
        ...(ip
          ? [
              [2, 'turn', 'bet', 16, 'human', null, null, null, P],
              [1, 'turn', 'raise', 64, 'horse_policy', null, null, null, H],
              [2, 'turn', 'call', 48, 'human', null, null, null, P],
              [2, 'river', 'check', 0, 'human', null, null, null, P],
              [1, 'river', 'check', 0, 'horse_policy', null, null, null, H],
            ]
          : [
              [2, 'turn', 'check', 0, 'horse_policy', null, null, null, H],
              [1, 'turn', 'bet', 16, 'human', null, null, null, P],
              [2, 'turn', 'raise', 64, 'horse_policy', null, null, null, H],
              [1, 'turn', 'call', 48, 'human', null, null, null, P],
              [2, 'river', 'check', 0, 'horse_policy', null, null, null, H],
              [1, 'river', 'check', 0, 'human', null, null, null, P],
            ]),
      ],
      w: [{ userId: H, amount: 144, potIndex: 0 }],
      pots: [{ amount: 144, eligible: [H, P] }],
      sd: [
        [ip ? 2 : 1, P, true],
        [ip ? 1 : 2, H, false],
      ],
      hc: { [H]: ['Qh', 'Tc', '4d', 'Kc', 'Ad'].map(card) },
    };
  };
  it("the combo draw that may raise in position is the engine's (omahaComboDrawForRaise) on 400 seeded flop and turn holdings", () => {
    const r = rng(20261127);
    const names = (cs: number[]) =>
      cs.map((c) => ({
        rank: '23456789TJQKA'[c >> 2],
        suit: ['clubs', 'diamonds', 'hearts', 'spades'][c & 3],
      }));
    let combos = 0;
    for (let i = 0; i < 400; i++) {
      const deck = Array.from({ length: 52 }, (_, k) => k);
      for (let k = 51; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [deck[k], deck[j]] = [deck[j]!, deck[k]!];
      }
      const nb = i % 2 === 0 ? 3 : 4;
      const nh = i % 3 === 0 ? 5 : 4;
      const board = deck.slice(0, nb);
      // half the holdings get two cards of a board suit and connected ranks, where combo draws live
      const hole = deck.slice(nb, nb + nh);
      if (i % 2 === 1) {
        const s0 = board[0]! & 3;
        const pick = deck
          .slice(nb + nh)
          .filter((c) => (c & 3) === s0)
          .slice(0, 2);
        hole.splice(0, 2, ...pick);
      }
      const mine = comboDrawForRaise(hole, board);
      expect(mine, `${hole} on ${board}`).toBe(
        omahaComboDrawForRaise(names(hole) as never, names(board) as never)
      );
      if (mine) combos++;
    }
    expect(combos).toBeGreaterThan(0);
  });
  it("a turn raise in position with that combo draw is the owner's 12:30 exception, not a breach (hand 13456d61)", () => {
    expect(comboDrawForRaise(C('Qh Tc 4d Kc Ad'), C('7d 9s Js 2d'))).toBe(true);
    const row = comboTurnRaise(true);
    const d = raiseRow(row);
    expect(d).toBeTruthy();
    expect(d.pos).toBe('IP');
    expect(d.nut_class).toBe('');
    expect(d.breach).toBe('');
    expect(d.note).toBe('turn in-position combo-draw raise (owner 12:30 exception)');
    expect(d.mtype).not.toBe('raised a non-nut hand on turn/river');
    expect(buildAudit([row], { tables, opts: FAST }).summary.breaches).toEqual([]);
  });
  it('the same combo draw raising the turn out of position is still the breach', () => {
    const d = raiseRow(comboTurnRaise(false));
    expect(d).toBeTruthy();
    expect(d.pos).toBe('OOP');
    expect(d.breach).toContain('non-nut raise turn/river');
  });

  /** Hand 8332e6c2 shape (PLO4, build 3aa21caa): the Horse checks the flop out of position and raises the bet. With
   * 8d Td Qc 7h on Ts 6c 3h (top pair and a 4-out gutshot) that is a made hand raising, not a draw (lead ruling
   * 2026-11-27); a bare wrap or a bare flush draw raising there is the breach. */
  const flopCheckRaise = (hole: string[], board: string[]) => ({
    id: '8332e6c2-0000-4000-8000-00000000000' + (hole[0] === '8d' ? '5' : '6'),
    created_at: '2026-11-27 17:06:00.000000+00',
    gv: 'plo4',
    bb: '1.00',
    btn: '1',
    build: '3aa21caa9f7d',
    hh: true,
    rake: '0',
    bbj: '0',
    pot: '46.00',
    tid: 't1',
    cc: board,
    cc2: null,
    rit: null,
    bomb: false,
    pl: [
      [1, P, 200, 'ShapePerson', false],
      [2, H, 200, 'ShapeHorse', true],
    ],
    ac: [
      [1, 'preflop', 'sb', 0.5, 'forced', false, null, null, P],
      [2, 'preflop', 'bb', 1, 'forced', false, null, null, H],
      [1, 'preflop', 'raise', 3, 'human', null, null, null, P],
      [2, 'preflop', 'call', 2, 'horse_policy', null, null, null, H],
      [2, 'flop', 'check', 0, 'horse_policy', null, null, null, H],
      [1, 'flop', 'bet', 5, 'human', null, null, null, P],
      [2, 'flop', 'raise', 20, 'horse_policy', null, null, null, H],
      [1, 'flop', 'call', 15, 'human', null, null, null, P],
      [2, 'turn', 'check', 0, 'horse_policy', null, null, null, H],
      [1, 'turn', 'check', 0, 'human', null, null, null, P],
      [2, 'river', 'check', 0, 'horse_policy', null, null, null, H],
      [1, 'river', 'check', 0, 'human', null, null, null, P],
    ],
    w: [{ userId: H, amount: 46, potIndex: 0 }],
    pots: [{ amount: 46, eligible: [H, P] }],
    sd: [
      [1, P, true],
      [2, H, false],
    ],
    hc: { [H]: hole.map(card) },
  });
  const flopRaiseRow = (row: unknown) =>
    buildAudit([row], { tables, opts: FAST }).decisions.find(
      (d: { street: string; act_taken?: string; tier: string }) =>
        d.street === 'flop' && d.tier === 'A' && d.act_taken === 'raise'
    );
  it('the draw for "draw raised OOP" is the engine\'s (omahaDrawRaiseBar) on 400 seeded flop and turn holdings', () => {
    const r = rng(20261128);
    const names = (cs: number[]) =>
      cs.map((c) => ({
        rank: '23456789TJQKA'[c >> 2],
        suit: ['clubs', 'diamonds', 'hearts', 'spades'][c & 3],
      }));
    let draws = 0;
    for (let i = 0; i < 400; i++) {
      const deck = Array.from({ length: 52 }, (_, k) => k);
      for (let k = 51; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [deck[k], deck[j]] = [deck[j]!, deck[k]!];
      }
      const nb = i % 2 === 0 ? 3 : 4;
      const nh = i % 3 === 0 ? 5 : 4;
      const board = deck.slice(0, nb);
      const hole = deck.slice(nb, nb + nh);
      if (i % 2 === 1) {
        const s0 = board[0]! & 3;
        hole.splice(
          0,
          2,
          ...deck
            .slice(nb + nh)
            .filter((c) => (c & 3) === s0)
            .slice(0, 2)
        );
      }
      const engine = omahaDrawRaiseBar({
        variant: nh === 5 ? 'plo5' : 'plo4',
        street: nb === 3 ? 'flop' : 'turn',
        hole: names(hole) as never,
        board: names(board) as never,
        inPosition: false,
        hiLo: false,
        multiBoard: false,
        bombPot: false,
        tournament: false,
        allInOrFold: false,
      });
      const mine = drawForRaiseBar(hole, board);
      expect(mine, `${hole} on ${board}`).toBe(engine === 'out_of_position');
      if (mine) draws++;
    }
    expect(draws).toBeGreaterThan(0);
  });
  it('one pair with a 4-out gutshot raising out of position is a made hand, not a draw raise (hand 8332e6c2)', () => {
    expect(drawForRaiseBar(C('8d Td Qc 7h'), C('Ts 6c 3h'))).toBe(false);
    const row = flopCheckRaise(
      ['8d', 'Td', 'Qc', '7h'],
      ['Tspades', '6clubs', '3hearts', 'Qhearts', 'Kspades']
    );
    const d = flopRaiseRow(row);
    expect(d).toBeTruthy();
    expect(d.pos).toBe('OOP');
    expect(d.breach).toBe('');
    expect(d.mtype).not.toBe('raised a draw out of position');
    expect(buildAudit([row], { tables, opts: FAST }).summary.breaches).toEqual([]);
  });
  it('a bare wrap or a bare flush draw raising out of position is still the breach', () => {
    expect(drawForRaiseBar(C('9d 8c 5h 4s'), C('7s 6c Kh'))).toBe(true);
    expect(drawForRaiseBar(C('Ah Kh 4c 5d'), C('9h 8h Qs'))).toBe(true);
    const wrap = flopRaiseRow(
      flopCheckRaise(
        ['9d', '8c', '5h', '4s'],
        ['7spades', '6clubs', 'Khearts', '2diamonds', '2clubs']
      )
    );
    expect(wrap.pos).toBe('OOP');
    expect(wrap.breach).toBe('draw raised OOP');
    const flush = flopRaiseRow(
      flopCheckRaise(
        ['Ah', 'Kh', '4c', '5d'],
        ['9hearts', '8hearts', 'Qspades', '2diamonds', '3clubs']
      )
    );
    expect(flush.breach).toBe('draw raised OOP');
  });
});
