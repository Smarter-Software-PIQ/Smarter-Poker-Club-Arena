/**
 * The audited-decision replay scorer joins by decision node, judges with the audit's own rules and splits
 * every outcome by rule receipt. Every row below is synthetic and anonymized (hand ids 9000xx, seat names
 * h1..h3, no real hole cards); only the column layouts are the audits' real formats.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_ON_OFF_NAMES,
} from '../engine/HorseOptionSwitch.js';
import {
  audit2Decisions,
  judgeAudit2,
  nodeKey,
  parseCsv,
  parseReplayBarRows,
  parseReplayFile,
  parseReplayJsonl,
  plo6Decisions,
  replayBarLine,
  replayBarRows,
  replayRefusals,
  replayValidity,
  scoreReplay,
  todaysOptionSetProblems,
  wooWooDecisions,
  type Audit2JudgeInputs,
} from './AuditedDecisionReplay.js';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const A2_HEADER =
  'hand,ts,grp,name,st,type,kind,amt,pot,tc,price,nlive,ip,cat,eqR,eqC,eqA,evb_bb,evc_bb,bluff,verdict,cause,loss_bb,hero,woo,board,net';
const a2row = (o: Record<string, string | number>) =>
  A2_HEADER.split(',')
    .map((h) => String(o[h] ?? ''))
    .join(',');

// Hand 900001: seat 5 (h2, a Horse) leads the flop (not audited, k = 0); seat 3 (h1, a Horse) calls that
// Horse's bet (not audited, k = 0); the human raises; h2 folds (audited, k = 1) and h1 calls (audited, k = 1).
// Hand 900002: seat 3 checks after the human checked on the turn (audited).
const HANDS = [
  {
    hand_number: 900001,
    big_blind: '2.00',
    players: [
      { seat: 1, name: 'p1' },
      { seat: 3, name: 'h1' },
      { seat: 5, name: 'h2' },
    ],
    actions: [
      { a: 'sb', o: 'forced', st: 'preflop', amt: 1, seat: 1, toCall: null },
      { a: 'call', o: 'horse_policy', st: 'preflop', amt: 2, seat: 3, toCall: 2 },
      { a: 'bet', o: 'horse_policy', st: 'flop', amt: 6, seat: 5, toCall: 0 },
      { a: 'call', o: 'horse_policy', st: 'flop', amt: 6, seat: 3, toCall: 6 },
      { a: 'raise', o: 'player', st: 'flop', amt: 30, seat: 1, toCall: 6 },
      { a: 'fold', o: 'horse_policy', st: 'flop', amt: 0, seat: 5, toCall: 24 },
      { a: 'call', o: 'horse_policy', st: 'flop', amt: 24, seat: 3, toCall: 24 },
    ],
  },
  {
    hand_number: 900002,
    big_blind: '2.00',
    players: [
      { seat: 1, name: 'p1' },
      { seat: 3, name: 'h1' },
    ],
    actions: [
      { a: 'check', o: 'player', st: 'turn', amt: 0, seat: 1, toCall: 0 },
      { a: 'check', o: 'horse_policy', st: 'turn', amt: 0, seat: 3, toCall: 0 },
    ],
  },
];
const HANDS_JSONL = HANDS.map((h) => JSON.stringify(h)).join('\n') + '\n';

const A2_CSV = [
  A2_HEADER,
  // h2 folds to the raise: realized equity 0.5 x 0.82 x 0.9 = 0.369 > price 0.2 + 0.08 -> the audit says wrong.
  a2row({
    hand: 900001,
    name: 'h2',
    st: 'flop',
    type: 'face_raise',
    kind: 'fold',
    pot: 96,
    tc: 24,
    price: 0.2,
    nlive: 3,
    ip: 'True',
    cat: 'V1',
    eqR: 0.5,
    verdict: 'wrong',
    cause: 'over-fold',
  }),
  // h1 calls the raise with equity 0.2: 0.2 x 0.82 x 0.9 = 0.148 < 0.2 - 0.05 -> wrong.
  a2row({
    hand: 900001,
    name: 'h1',
    st: 'flop',
    type: 'face_raise',
    kind: 'call',
    pot: 96,
    tc: 24,
    price: 0.2,
    nlive: 3,
    ip: 'True',
    cat: 'W',
    eqR: 0.2,
    verdict: 'wrong',
    cause: 'light call',
  }),
  // h1 checks back the turn: evb 30 > evc 10 + 0.15 x 20 bb -> wrong (missed bet).
  a2row({
    hand: 900002,
    name: 'h1',
    st: 'turn',
    type: 'checked_to',
    kind: 'check',
    pot: 40,
    tc: 0,
    price: 0,
    nlive: 2,
    ip: 'True',
    cat: 'V2',
    eqR: 0.7,
    evb_bb: 30,
    evc_bb: 10,
    verdict: 'wrong',
    cause: 'missed bet',
  }),
  // A row whose hand is not in the hands file is reported, not placed.
  a2row({
    hand: 900099,
    name: 'h3',
    st: 'river',
    type: 'face_bet',
    kind: 'call',
    pot: 10,
    tc: 5,
    price: 0.33,
    nlive: 2,
    ip: 'True',
    cat: 'A',
    eqR: 0.1,
    verdict: 'wrong',
  }),
].join('\n');

describe('AuditedDecisionReplay', () => {
  it('parses quoted CSV fields, doubled quotes and newlines inside quotes', () => {
    const rows = parseCsv('a,b,c\n1,"x, ""y""",3\r\n4,"line\nbreak",6\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, "y"', c: '3' },
      { a: '4', b: 'line\nbreak', c: '6' },
    ]);
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/3 fields/);
  });

  it('places audit2 rows at their node: k counts every horse_policy decision of the seat on the street', () => {
    const r = audit2Decisions(A2_CSV, HANDS_JSONL);
    expect(r.unplaced).toEqual([
      { row: 5, hand: '900099', name: 'h3', street: 'river', reason: 'hand not in hands file' },
    ]);
    expect(r.ambiguous).toBe(0); // h1's two flop calls are told apart by the amount to call (6 vs 24)
    const keys = r.decisions.map((d) => nodeKey(d.node));
    // Each audited answer to the raise is its seat's SECOND flop decision: the unaudited lead and call are k = 0.
    expect(keys).toEqual(['900001:5:flop:1', '900001:3:flop:1', '900002:3:turn:0']);
    expect(r.decisions.map((d) => [d.recorded.action, d.recorded.amount, d.cls])).toEqual([
      ['fold', 0, 'bad'],
      ['call', 24, 'bad'],
      ['check', 0, 'bad'],
    ]);
    expect(r.decisions[0].judge?.bb).toBe(2);
  });

  it('judges any action with the audit2 rules and prices it in bb', () => {
    const j: Audit2JudgeInputs = {
      type: 'face_bet',
      pot: 100,
      tc: 50,
      price: 50 / 150,
      nlive: 2,
      ip: false,
      cat: 'V1',
      eqR: 0.6,
      evbBb: null,
      evcBb: null,
      bb: 2,
      hero: '',
    };
    // Turn OOP realization 0.8: realized 0.48 > price 0.333 + 0.08 -> the fold is bad, the call is ok.
    expect(judgeAudit2(j, 'turn', 'fold', null)).toEqual({ cls: 'bad', evBb: 0 });
    const call = judgeAudit2(j, 'turn', 'call', 50);
    expect(call.cls).toBe('ok');
    expect(call.evBb).toBeCloseTo((0.48 * 150 - 50) / 2, 10);
    // A raise is judged by the audit's equity bar (0.40) and not priced.
    expect(judgeAudit2(j, 'turn', 'raise', 200)).toEqual({ cls: 'ok', evBb: null });
    expect(judgeAudit2({ ...j, eqR: 0.3 }, 'turn', 'raise', 200)).toEqual({
      cls: 'bad',
      evBb: null,
    });
    // Checked to: a bet under 25% of a pot of 4 bb or more is bad whatever its EV.
    const c: Audit2JudgeInputs = {
      ...j,
      type: 'checked_to',
      tc: 0,
      price: 0,
      evbBb: 30,
      evcBb: 10,
    };
    expect(judgeAudit2(c, 'turn', 'bet', 60)).toEqual({ cls: 'ok', evBb: 30 });
    expect(judgeAudit2(c, 'turn', 'bet', 20)).toEqual({ cls: 'bad', evBb: 30 });
    expect(judgeAudit2(c, 'turn', 'check', null)).toEqual({ cls: 'bad', evBb: 10 });
    // Nothing the audit did not judge is given a verdict.
    expect(judgeAudit2({ ...j, type: 'raise_other' }, 'turn', 'call', 50).cls).toBe('unjudged');
    expect(judgeAudit2({ ...j, bb: 0 }, 'turn', 'call', 50).cls).toBe('unjudged');
  });

  it('scores by node, not by position, and splits outcomes per rule receipt', () => {
    const audit2 = audit2Decisions(A2_CSV, HANDS_JSONL);
    // Rows in a different order from the audit, one extra unaudited node, the call node twice is refused.
    const replay = parseReplayJsonl(
      [
        {
          hand: 900002,
          seat: 3,
          street: 'turn',
          k: 0,
          arms: {
            off: { action: 'check' },
            on: { action: 'bet', amount: 30, receipts: ['rule_b'] },
          },
        },
        {
          hand: 900001,
          seat: 3,
          street: 'flop',
          k: 0,
          arms: {
            off: { action: 'call', amount: 6 },
            on: { action: 'fold', receipts: ['rule_a'] },
          },
        },
        {
          hand: 900001,
          seat: 3,
          street: 'flop',
          k: 1,
          arms: {
            off: { action: 'call', amount: 24 },
            on: { action: 'fold', receipts: ['rule_a'] },
          },
        },
        {
          hand: 900001,
          seat: 5,
          street: 'flop',
          k: 1,
          arms: { off: { action: 'fold' }, on: { action: 'fold' } },
        },
      ]
        .map((o) => JSON.stringify(o))
        .join('\n')
    );
    const report = scoreReplay([{ source: 'audit2', decisions: audit2.decisions }], replay);
    expect(report.replayRows).toBe(4);
    expect(report.replayRowsWithoutAudit).toBe(1); // 900001:3:flop:0 was never audited
    expect(report.changedWithoutAudit).toEqual({ on: 1 }); // its call -> fold is shown, not scored
    const s = report.sources[0];
    expect([s.audited, s.replayed, s.notReplayed, s.baseReproducesRecorded]).toEqual([3, 3, 0, 3]);
    expect(s.judgeAgreesWithAudit).toEqual({ agree: 3, judged: 3 });
    const on = s.arms.find((a) => a.arm === 'on')!;
    // Call -> fold of a bad call is fixed (fold 0 vs call EV < 0); check -> bet of a missed bet is fixed;
    // the bad fold that stayed a fold is left unchanged. The unaudited node is never scored.
    expect([on.changed, on.fixed, on.newlyWrong, on.stillWrong, on.unchangedBad]).toEqual([
      2, 2, 0, 0, 1,
    ]);
    expect([on.moreAggressive, on.morePassive]).toEqual([1, 1]);
    const callEv = (0.2 * 0.82 * 0.9 * 120 - 24) / 2;
    expect(on.evPriced).toBe(2);
    expect(on.evSumBb).toBeCloseTo(Math.round((0 - callEv + (30 - 10)) * 100) / 100, 2);
    expect(on.fixedNodes.sort()).toEqual(['900001:3:flop:1', '900002:3:turn:0']);
    expect(Object.keys(on.perReceipt)).toEqual(['rule_a', 'rule_b']);
    expect(on.perReceipt.rule_a.fixed).toBe(1);
    expect(on.perReceipt.rule_b.evSumBb).toBe(20);
    const line = replayBarLine(report, 'on');
    expect(line).toContain('joined by node: 3 replayed, 0 not replayed');
    expect(line).toContain('fixed 2, newly wrong 0');
    expect(line).toContain('per receipt: rule_a 1 changed / 1 fixed / 0 newly wrong');

    const dup = scoreReplay(
      [{ source: 'audit2', decisions: audit2.decisions }],
      [...replay, replay[0]]
    );
    expect(dup.duplicateReplayNodes).toEqual(['900002:3:turn:0']);
  });

  it('scores the WooWoo audit verdict-only: a change away from a bad action is fixed, from an ok one newly wrong', () => {
    const full = [
      'hand_number,dec_idx,name,seat,street,action,amount',
      // Out of order on purpose: k follows dec_idx, not file order.
      '900010,3,h1,3,flop,call,10',
      '900010,1,h1,3,flop,check,',
      '900010,2,h2,5,flop,fold,',
      '900010,4,h2,5,turn,check,',
    ].join('\n');
    const findings = [
      'hand,d,verdict,finding_id,corrective_action',
      '900010,1,correct,NONE-CORRECT,keep',
      '900010,2,wrong,F-04,"call, do not fold"',
      '900010,3,questionable,F-11,x',
      '900010,4,acceptable_close,NONE,x',
    ].join('\n');
    const w = wooWooDecisions(full, findings);
    expect(w.unplaced).toEqual([]);
    expect(w.decisions.map((d) => [nodeKey(d.node), d.cls, d.finding])).toEqual([
      ['900010:3:flop:0', 'ok', 'NONE-CORRECT'],
      ['900010:5:flop:0', 'bad', 'F-04'],
      ['900010:3:flop:1', 'bad', 'F-11'],
      ['900010:5:turn:0', 'ok', 'NONE'],
    ]);
    const replay = parseReplayJsonl(
      [
        {
          hand: '900010',
          seat: 5,
          street: 'flop',
          k: 0,
          arms: { off: { action: 'fold' }, on: { action: 'call', receipts: ['rule_c'] } },
        },
        {
          hand: '900010',
          seat: 3,
          street: 'flop',
          k: 0,
          arms: { off: { action: 'check' }, on: { action: 'bet', receipts: ['rule_c'] } },
        },
        // The base arm does not reproduce the recorded call: the change cannot be judged verdict-only.
        {
          hand: '900010',
          seat: 3,
          street: 'flop',
          k: 1,
          arms: { off: { action: 'fold' }, on: { action: 'call' } },
        },
      ]
        .map((o) => JSON.stringify(o))
        .join('\n')
    );
    const s = scoreReplay([{ source: 'woowoo', decisions: w.decisions }], replay).sources[0];
    expect(s.method).toBe('verdict-only');
    expect([s.replayed, s.notReplayed, s.baseReproducesRecorded]).toEqual([3, 1, 2]);
    expect(s.baseDiffers).toEqual(['900010:3:flop:1']);
    const on = s.arms[0];
    expect([on.changed, on.fixed, on.newlyWrong, on.changedUnjudged, on.evPriced]).toEqual([
      3, 1, 1, 1, 0,
    ]);
    expect(on.perReceipt['rule_c']).toMatchObject({ changed: 2, fixed: 1, newlyWrong: 1 });
    expect(on.perReceipt['(no receipt)']).toMatchObject({ changed: 1, changedUnjudged: 1 });
    expect(
      replayBarLine(
        {
          base: 'off',
          replayRows: 3,
          replayRowsWithoutAudit: 0,
          changedWithoutAudit: {},
          duplicateReplayNodes: [],
          sources: [s],
        },
        'on'
      )
    ).toContain('no bb (the audit declares no EV model)');
  });

  it('refuses a replay line without its node fields', () => {
    expect(() => parseReplayJsonl('{"hand":1,"seat":2,"street":"flop","arms":{}}')).toThrow(
      /line 1/
    );
    expect(() =>
      parseReplayJsonl('{"hand":1,"seat":2,"street":"showdown","k":0,"arms":{}}')
    ).toThrow(/line 1/);
  });
});

// ── 2026-11-19: an arm must be the option set it is named for; the machine-read Replay row ──
describe('audited decision replay: validity of the arms and the authority Replay row', () => {
  const ON_A = OPTION_SWITCH_ON_OFF_NAMES[0];
  const ON_B = OPTION_SWITCH_ON_OFF_NAMES[1];
  const OFF_ONLY = OPTION_SWITCH_OFF_ONLY_NAMES[0];
  const node = (k: number, off: object, on: object) =>
    JSON.stringify({ hand: 900020, seat: 3, street: 'flop', k, arms: { off, on } });
  const meta = (off: object, on: object) =>
    JSON.stringify({ meta: { arms: { off: { options: off }, on: { options: on } } } });

  it("names the options today's registry refuses, by the registry's own whole-set rule", () => {
    expect(todaysOptionSetProblems({ [ON_A]: 'on', [ON_B]: 'off', [OFF_ONLY]: 'off' })).toEqual([]);
    expect(todaysOptionSetProblems({})).toEqual([]);
    const p = todaysOptionSetProblems({
      [ON_A]: 'on',
      [OFF_ONLY]: 'on',
      notAnOptionAnyMore: 'off',
      [ON_B]: true,
    });
    expect(p.map((x) => [x.option, x.state, x.problem])).toEqual([
      [OFF_ONLY, 'on', 'off-only'],
      ['notAnOptionAnyMore', 'off', 'unregistered'],
      [ON_B, 'true', 'unsupported state'],
    ]);
  });

  it('refuses a journaled set that is off-only or unregistered today: the arm switched nothing', () => {
    // The flop-read replay of 2026-11-19: one journaled option was `on` in every record and is off-only today, so
    // the registry refused every arm's set and four arms came out identical. Here both arms carry it.
    const file = parseReplayFile(
      [
        meta({ [OFF_ONLY]: 'on' }, { [OFF_ONLY]: 'on', [ON_A]: 'on' }),
        node(0, { action: 'call', amount: 6 }, { action: 'call', amount: 6 }),
        node(1, { action: 'fold' }, { action: 'fold' }),
      ].join('\n')
    );
    expect(file.rows).toHaveLength(2);
    const v = replayValidity(file);
    expect(v.map((x) => [x.arm, x.rows, x.rowsWithOptions, x.invalidRows])).toEqual([
      ['off', 2, 2, 2],
      ['on', 2, 2, 2],
    ]);
    const refusals = replayRefusals(v);
    expect(refusals).toHaveLength(3);
    expect(refusals[0]).toMatch(/^base arm "off" is INERT on 2 of 2 rows/);
    expect(refusals[0]).toContain(`${OFF_ONLY} on: off-only`);
    expect(refusals[1]).toMatch(/^arm "on" is INERT on 2 of 2 rows/);
    expect(refusals[2]).toMatch(
      /^arm "on" is identical to the base arm "off" on all 2 compared rows/
    );

    // An unregistered name refuses the set even when it is `off`; a row's own set wins over the meta line.
    const perRow = parseReplayFile(
      [
        meta({}, { [ON_A]: 'on' }),
        node(
          0,
          { action: 'call' },
          { action: 'fold', options: { [ON_A]: 'on', goneOption: 'off' } }
        ),
        node(1, { action: 'call' }, { action: 'fold' }),
      ].join('\n')
    );
    const r = replayRefusals(replayValidity(perRow));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^arm "on" is INERT on 1 of 2 rows/);
    expect(r[0]).toContain('goneOption off: unregistered');
  });

  it('accepts the sanitized replay, names what each arm switches, and refuses an undeclared identical arm', () => {
    const lines = [
      JSON.stringify({
        meta: {
          arms: {
            off: { options: { [OFF_ONLY]: 'off' }, sanitized: { [`${OFF_ONLY}:on>off`]: 2 } },
            on: { options: { [OFF_ONLY]: 'off', [ON_A]: 'on' } },
            control: { options: { [OFF_ONLY]: 'off', [ON_B]: 'on' } },
          },
        },
      }),
      JSON.stringify({
        hand: 900020,
        seat: 3,
        street: 'flop',
        k: 0,
        arms: {
          off: { action: 'call', amount: 6 },
          on: { action: 'fold', receipts: ['rule_a'] },
          control: { action: 'call', amount: 6 },
        },
      }),
      JSON.stringify({
        hand: 900020,
        seat: 3,
        street: 'flop',
        k: 1,
        arms: {
          off: { action: 'check' },
          on: { action: 'check' },
          control: { action: 'check' },
        },
      }),
    ];
    const v = replayValidity(parseReplayFile(lines.join('\n')));
    const on = v.find((x) => x.arm === 'on')!;
    expect([on.switchedOn, on.switchedOff, on.comparedRows, on.differingRows]).toEqual([
      [ON_A],
      [],
      2,
      1,
    ]);
    expect(v.find((x) => x.arm === 'off')!.sanitized).toEqual({ [`${OFF_ONLY}:on>off`]: 2 });
    const refusals = replayRefusals(v);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/^arm "control" is identical to the base arm "off" on all 2/);
    expect(replayRefusals(v, { allowUnchanged: ['control'] })).toEqual([]);
    // A receipt alone is a difference: a rule that fired without changing the action is not an inert arm.
    const fired = parseReplayFile(
      node(0, { action: 'call' }, { action: 'call', receipts: ['rule_a'] })
    );
    expect(replayRefusals(replayValidity(fired))).toEqual([]);
    // An authority row is refused when the arms it is written from do not declare their option sets.
    const undeclared = replayRefusals(replayValidity(fired), { requireOptionsFor: ['off', 'on'] });
    expect(undeclared).toHaveLength(2);
    expect(undeclared[1]).toMatch(/^arm "on" declares no option set on 1 of 1 rows/);
    // A base arm that is not in the file is refused, never scored as "nothing changed".
    expect(replayRefusals(replayValidity(fired, 'base'))).toEqual(
      expect.arrayContaining(['base arm "base" has no replay row'])
    );
  });

  it('writes the Replay row the authority law reads, and counts unchanged decisions', () => {
    const full = [
      'hand_number,dec_idx,name,seat,street,action,amount',
      '900020,1,h1,3,flop,call,6',
      '900020,2,h1,3,flop,check,',
      '900020,3,h1,3,turn,call,9',
    ].join('\n');
    const findings = [
      'hand,d,verdict,finding_id,corrective_action',
      '900020,1,wrong,F-01,fold',
      '900020,2,correct,NONE,keep',
      '900020,3,correct,NONE,keep',
    ].join('\n');
    const replay = parseReplayJsonl(
      [
        node(0, { action: 'call', amount: 6 }, { action: 'fold' }),
        node(1, { action: 'check' }, { action: 'check' }),
        JSON.stringify({
          hand: 900020,
          seat: 3,
          street: 'turn',
          k: 0,
          arms: { off: { action: 'call', amount: 9 }, on: { action: 'fold' } },
        }),
      ].join('\n')
    );
    const report = scoreReplay(
      [{ source: 'woowoo', decisions: wooWooDecisions(full, findings).decisions }],
      replay
    );
    const on = report.sources[0].arms[0];
    expect([on.changed, on.fixed, on.newlyWrong, on.unchanged, on.changedUnjudged]).toEqual([
      2, 1, 1, 1, 0,
    ]);
    const rows = replayBarRows(report, 'on', { set: 'synthetic three', scorer: 'abcdef01234' });
    expect(rows).toEqual([
      '- Replay: fixed 1; newlyWrong 1; changed 2; unchanged 1; unjudged 0; set synthetic three; scorer abcdef01234; source woowoo verdict-only; arm on vs off; replayed 3 of 3',
    ]);
    expect(() => replayBarRows(report, 'on', { set: 'a; b', scorer: 'abcdef01234' })).toThrow();
    expect(() => replayBarRows(report, 'on', { set: 'a', scorer: 'unknown' })).toThrow();
    expect(() => replayBarRows(report, 'absent', { set: 'a', scorer: 'abcdef01234' })).toThrow();

    const parsed = parseReplayBarRows(
      [
        '# x',
        rows[0],
        '- Replay: NOT RUN (no replay on audited decisions is recorded)',
        '- Replay: LEGACY (recorded in prose in this file only)',
        '- Replay: fixed 3; newlyWrong x; changed 4; set s; scorer abcdef0',
        '- Replay: fixed 3; newlyWrong 1; changed 4; scorer abcdef0',
        '- Replay: fixed 3; newlyWrong 1; changed 4; set s; scorer main',
        '- Replay: NOT RUN',
        '- Replay: NOT RUN (short)',
        '- Replay row: MET (prose, not a machine row)',
      ].join('\n')
    );
    expect(parsed.rows.map((r) => r.state)).toEqual(['RUN', 'NOT RUN', 'LEGACY']);
    expect(parsed.rows[0]).toMatchObject({
      fixed: 1,
      newlyWrong: 1,
      changed: 2,
      set: 'synthetic three',
      scorer: 'abcdef01234',
    });
    expect(parsed.malformed).toHaveLength(5);
  });

  it('the CLI exits 2 and scores nothing when an arm is inert, and prints the Replay row for a valid replay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audited-replay-'));
    try {
      const w = (name: string, text: string) => {
        writeFileSync(join(dir, name), text);
        return join(dir, name);
      };
      const full = w(
        'full.csv',
        'hand_number,dec_idx,name,seat,street,action,amount\n900020,1,h1,3,flop,call,6\n900020,2,h1,3,flop,check,\n'
      );
      const findings = w(
        'findings.csv',
        'hand,d,verdict,finding_id,corrective_action\n900020,1,wrong,F-01,fold\n900020,2,correct,NONE,keep\n'
      );
      const body = [
        node(0, { action: 'call', amount: 6 }, { action: 'fold' }),
        node(1, { action: 'check' }, { action: 'check' }),
      ];
      const inert = w(
        'inert.jsonl',
        [meta({ [OFF_ONLY]: 'on' }, { [OFF_ONLY]: 'on', [ON_A]: 'on' }), ...body].join('\n')
      );
      const valid = w(
        'valid.jsonl',
        [meta({ [OFF_ONLY]: 'off' }, { [OFF_ONLY]: 'off', [ON_A]: 'on' }), ...body].join('\n')
      );
      const out = join(dir, 'report.json');
      const run = (replay: string, extra: string[]) =>
        spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            'scripts/audited-decision-replay.ts',
            '--woowoo',
            full,
            '--woowoo-findings',
            findings,
            '--replay',
            replay,
            ...extra,
          ],
          { cwd: SERVER_DIR, encoding: 'utf8', timeout: 240_000 }
        );
      const refused = run(inert, ['--json', out, '--line', 'on']);
      expect(refused.status, refused.stderr).toBe(2);
      expect(refused.stderr).toContain(`REFUSED: arm "on" is INERT on 2 of 2 rows`);
      expect(refused.stderr).toContain(`${OFF_ONLY} on: off-only`);
      expect(refused.stdout).not.toContain('Authority replay line');
      expect(refused.stdout).not.toMatch(/fixed \d/);
      expect(existsSync(out)).toBe(false);

      const ok = run(valid, [
        '--row',
        'on',
        '--set',
        'synthetic two',
        '--scorer-commit',
        'abcdef01234',
      ]);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain(`on vs base: ${ON_A}; differs from base on 1 of 2 rows`);
      expect(ok.stdout).toContain(
        '- Replay: fixed 1; newlyWrong 0; changed 1; unchanged 1; unjudged 0; set synthetic two; scorer abcdef01234; source woowoo verdict-only; arm on vs off; replayed 2 of 2'
      );
      // The same replay without declared option sets is scored, but no authority row is written from it.
      const bare = run(w('bare.jsonl', body.join('\n')), ['--row', 'on', '--set', 'synthetic two']);
      expect(bare.status).toBe(2);
      expect(bare.stderr).toContain('declares no option set');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

// ── 2026-11-20: the PLO6 audit set (HVH48 auditor C). Synthetic six-card hands in the extracted-hand shape ──
describe('audited decision replay: the PLO6 audit set', () => {
  const c = (rank: string, suit: string) => ({ rank, suit });
  const SIX_A = [
    c('A', 'spades'),
    c('A', 'hearts'),
    c('K', 'spades'),
    c('Q', 'hearts'),
    c('J', 'diamonds'),
    c('T', 'clubs'),
  ];
  const SIX_B = [
    c('9', 'spades'),
    c('9', 'hearts'),
    c('8', 'spades'),
    c('7', 'hearts'),
    c('6', 'diamonds'),
    c('5', 'clubs'),
  ];
  const act = (
    ord: number,
    seat: number,
    stage: string,
    origin: string,
    action: string,
    amount = 0
  ) => ({
    ord,
    seat,
    stage,
    origin,
    action,
    amount,
    userId: `u${seat}`,
    publicNode: { boards: ['Td2sTc'], toCall: amount },
  });
  // Hand 910001 (PLO6): seat 2 and seat 4 are Horses, seat 1 a person.
  //   flop: seat 2 checks (k 0), the person bets, seat 4 calls (k 0), seat 2 folds (k 1);
  //   turn: the person bets, seat 4 folds (k 0);
  //   river: nobody audited. A pre_action row and the person's rows are never a node.
  const HAND_1 = {
    handId: 'h-910001',
    variant: 'plo6',
    handNumber: 910001,
    bigBlind: 1,
    smallBlind: 0.5,
    board: ['Tdiamonds', '2spades', 'Tclubs', '5clubs'],
    players: [
      { seat: 1, userId: 'u1', isHorse: false },
      { seat: 2, userId: 'u2', isHorse: true },
      { seat: 4, userId: 'u4', isHorse: true },
    ],
    horseHoleCards: { u2: SIX_A, u4: SIX_B },
    actions: [
      act(0, 1, 'preflop', 'forced', 'bb', 1),
      act(1, 2, 'preflop', 'horse_policy', 'call', 1),
      act(2, 4, 'preflop', 'pre_action', 'call', 1),
      act(3, 2, 'flop', 'horse_policy', 'check'),
      act(4, 1, 'flop', 'player', 'bet', 3),
      act(5, 4, 'flop', 'horse_policy', 'call', 3),
      act(6, 2, 'flop', 'horse_policy', 'fold'),
      act(7, 1, 'turn', 'player', 'bet', 9),
      act(8, 4, 'turn', 'horse_policy', 'fold'),
    ],
  };
  // Hand 910002 (PLO6), given in the {hand: ...} wrapper: seat 3 calls a river bet, then a river raise.
  const HAND_2 = {
    handId: 'h-910002',
    variant: 'plo6',
    handNumber: 910002,
    bigBlind: 1,
    smallBlind: 0.5,
    players: [
      { seat: 1, userId: 'u1', isHorse: false },
      { seat: 3, userId: 'u3', isHorse: true },
    ],
    horseHoleCards: { u3: SIX_B },
    actions: [
      act(0, 1, 'river', 'player', 'bet', 10),
      act(1, 3, 'river', 'horse_policy', 'raise', 30),
      act(2, 1, 'river', 'player', 'raise', 90),
      act(3, 3, 'river', 'horse_policy', 'call', 60),
    ],
  };
  // A five-card hand that is not PLO6, and a hand whose actions carry no ord.
  const HAND_PLO5 = { ...HAND_2, handId: 'h-910003', handNumber: 910003, variant: 'plo5' };
  const HAND_NO_ORD = {
    ...HAND_2,
    handId: 'h-910004',
    handNumber: 910004,
    actions: HAND_2.actions.map(({ ord: _ord, ...rest }) => rest),
  };
  const HANDS = [HAND_1, { hand: HAND_2 }, HAND_PLO5, HAND_NO_ORD]
    .map((h) => JSON.stringify(h))
    .join('\n');
  const HEADER = 'id,hand,ord,seat,street,action,flag,verdict';
  const CSV = [
    HEADER,
    'd1,910001,6,2,flop,fold,POTODDS-FOLD,CLEAR',
    'd2,910001,8,4,turn,fold,ALLIN-FOLD-PRICED,LIKELY',
    'd3,910001,5,4,flop,call,,OK',
    'd4,910001,3,,,,,',
    'd5,910002,3,3,river,call,,OK',
    'd6,910002,1,3,river,raise,,',
  ].join('\n');

  it('places a row by its action ordinal: k counts the seat own Horse decisions, and no card is kept', () => {
    const r = plo6Decisions(CSV, HANDS);
    expect(r.unplaced).toEqual([]);
    expect(
      r.decisions.map((d) => [d.at?.id, nodeKey(d.node), d.recorded.action, d.cls, d.finding])
    ).toEqual([
      ['d1', '910001:2:flop:1', 'fold', 'bad', 'POTODDS-FOLD'],
      ['d2', '910001:4:turn:0', 'fold', 'bad', 'ALLIN-FOLD-PRICED'],
      ['d3', '910001:4:flop:0', 'call', 'ok', undefined],
      ['d4', '910001:2:flop:0', 'check', 'unjudged', undefined],
      ['d5', '910002:3:river:1', 'call', 'ok', undefined],
      ['d6', '910002:3:river:0', 'raise', 'unjudged', undefined],
    ]);
    expect(r.decisions.every((d) => d.source === 'plo6' && d.judge === undefined)).toBe(true);
    expect(r.decisions[4].recorded.amount).toBe(60);
    // The firewall: the hands file holds six hole cards a Horse and a board; none of it leaves the adapter.
    const out = JSON.stringify(r);
    for (const word of ['spades', 'hearts', 'diamonds', 'clubs', 'rank', 'Td2sTc', 'HoleCards'])
      expect(out).not.toContain(word);
  });

  it('scores verdict-only: a flagged fold that becomes a call is fixed, a change away from an OK action is newly wrong', () => {
    const r = plo6Decisions(CSV, HANDS);
    const row = (hand: number, seat: number, street: string, k: number, off: object, on: object) =>
      JSON.stringify({ hand, seat, street, k, arms: { off, on } });
    const replay = parseReplayJsonl(
      [
        // Two flagged folds flip to the call: fixed.
        row(
          910001,
          2,
          'flop',
          1,
          { action: 'fold' },
          { action: 'call', amount: 3, receipts: ['plo6_facing_bet_priced_called'] }
        ),
        row(
          910001,
          4,
          'turn',
          0,
          { action: 'fold' },
          { action: 'call', amount: 9, receipts: ['plo6_facing_bet_priced_called'] }
        ),
        // An OK river call becomes a fold: newly wrong.
        row(
          910002,
          3,
          'river',
          1,
          { action: 'call', amount: 60 },
          { action: 'fold', receipts: ['plo6_facing_bet_priced_folded'] }
        ),
        // An OK call the arm leaves alone, and an unflagged check the arm changes (unjudged).
        row(910001, 4, 'flop', 0, { action: 'call', amount: 3 }, { action: 'call', amount: 3 }),
        row(910001, 2, 'flop', 0, { action: 'check' }, { action: 'bet', amount: 2 }),
        // A node no audit row names: counted, never scored.
        row(910001, 2, 'preflop', 0, { action: 'call' }, { action: 'fold' }),
      ].join('\n')
    );
    const report = scoreReplay([{ source: 'plo6', decisions: r.decisions }], replay);
    const s = report.sources[0];
    expect([s.source, s.method]).toEqual(['plo6', 'verdict-only']);
    expect([s.audited, s.auditedBad, s.replayed, s.notReplayed, s.baseReproducesRecorded]).toEqual([
      6, 2, 5, 1, 5,
    ]);
    expect([report.replayRowsWithoutAudit, report.changedWithoutAudit.on]).toEqual([1, 1]);
    const on = s.arms[0];
    expect([
      on.changed,
      on.fixed,
      on.newlyWrong,
      on.changedUnjudged,
      on.unchanged,
      on.evPriced,
    ]).toEqual([4, 2, 1, 1, 1, 0]);
    expect(on.fixedNodes).toEqual(['910001:2:flop:1', '910001:4:turn:0']);
    expect(on.newlyWrongNodes).toEqual(['910002:3:river:1']);
    expect(on.perReceipt['plo6_facing_bet_priced_called']).toMatchObject({ changed: 2, fixed: 2 });
    expect(on.perReceipt['plo6_facing_bet_priced_folded']).toMatchObject({
      changed: 1,
      newlyWrong: 1,
    });
    expect(replayBarLine(report, 'on')).toContain('no bb (the audit declares no EV model)');
    const rows = replayBarRows(report, 'on', { set: 'synthetic plo6', scorer: 'abcdef01234' });
    expect(rows).toEqual([
      '- Replay: fixed 2; newlyWrong 1; changed 4; unchanged 1; unjudged 1; set synthetic plo6; scorer abcdef01234; source plo6 verdict-only; arm on vs off; replayed 5 of 6',
    ]);
    expect(parseReplayBarRows(rows[0]).rows[0]).toMatchObject({
      state: 'RUN',
      fixed: 2,
      newlyWrong: 1,
    });
  });

  it('a flagged fold the base arm does not reproduce is unjudged, never counted as fixed', () => {
    const r = plo6Decisions(CSV, HANDS);
    const replay = parseReplayJsonl(
      JSON.stringify({
        hand: 910001,
        seat: 2,
        street: 'flop',
        k: 1,
        arms: { off: { action: 'call', amount: 3 }, on: { action: 'raise', amount: 12 } },
      })
    );
    const s = scoreReplay([{ source: 'plo6', decisions: r.decisions }], replay).sources[0];
    expect(s.baseDiffers).toEqual(['910001:2:flop:1']);
    expect([s.arms[0].fixed, s.arms[0].newlyWrong, s.arms[0].changedUnjudged]).toEqual([0, 0, 1]);
  });

  it('refuses a malformed row with its reason and never places it at a neighbour', () => {
    expect(() => plo6Decisions('id,hand,verdict\nd1,910001,CLEAR\n', HANDS)).toThrow(/lacks ord/);
    expect(() => plo6Decisions(`${HEADER}\nd1,910001,6,2,flop\n`, HANDS)).toThrow(
      /csv row has 5 fields/
    );
    expect(() => plo6Decisions(CSV, '{"variant":"plo6","actions":[]}')).toThrow(/line 1/);
    expect(() =>
      plo6Decisions(CSV, `${JSON.stringify(HAND_1)}\n${JSON.stringify(HAND_1)}`)
    ).toThrow(/given twice/);
    const bad = [
      HEADER,
      'd10,910001,6,2,flop,fold,,WRONG', // a verdict word outside the declared ones
      'd11,910001,six,2,flop,fold,,CLEAR', // ord is not a whole number
      'd12,910001,4,,,,,CLEAR', // the person's bet
      'd13,910001,2,,,,,CLEAR', // a pre-action, not a decision of the brain
      'd14,910001,99,,,,,CLEAR', // no such action
      'd15,919999,1,,,,,CLEAR', // hand absent
      'd16,910003,3,,,,,CLEAR', // not PLO6
      'd17,910004,3,,,,,CLEAR', // the hand has no ord
      'd18,910001,6,4,flop,fold,,CLEAR', // the seat is another seat
      'd19,910001,6,2,turn,fold,,CLEAR', // the street is another street
      'd20,910001,6,2,flop,call,,CLEAR', // the action is another action
      ',910001,6,2,flop,fold,,CLEAR', // no decision id
      'd21,910001,8,4,turn,fold,,CLEAR', // placed
      'd22,910001,8,4,turn,fold,,LIKELY', // the same node again
    ].join('\n');
    const r = plo6Decisions(bad, HANDS);
    expect(r.decisions.map((d) => d.at?.id)).toEqual(['d21']);
    expect(r.unplaced.map((u) => [u.row, u.name, u.reason])).toEqual([
      [2, 'd10', 'verdict "WRONG" is not CLEAR, LIKELY, OK or empty'],
      [3, 'd11', 'ord "six" is not a whole number'],
      [4, 'd12', 'the action at ord 4 is not a voluntary Horse decision'],
      [5, 'd13', 'the action at ord 2 is not a voluntary Horse decision'],
      [6, 'd14', 'no action at ord 99'],
      [7, 'd15', 'hand not in hands file'],
      [8, 'd16', 'hand is not plo6 (variant plo5)'],
      [9, 'd17', 'the hand has an action without a whole-number ord'],
      [10, 'd18', 'seat 4 is not the seat at ord 6 (2)'],
      [11, 'd19', 'street turn is not the street at ord 6 (flop)'],
      [12, 'd20', 'action call is not the action at ord 6 (fold)'],
      [13, '', 'no decision id'],
      [15, 'd22', 'the node is already audited by row 14'],
    ]);
  });

  it('places the committed anonymised sample of the audit set (Plo6FacingBetIsPriced.fixture.json)', () => {
    const fixture = JSON.parse(
      readFileSync(join(SERVER_DIR, 'src/engine/Plo6FacingBetIsPriced.fixture.json'), 'utf8')
    ) as { hands: { hand: { handNumber: number }; ords: number[]; ids: Record<string, string> }[] };
    // The fixture carries the audit's decision id and ordinal, not its verdict word: the rows are unjudged here.
    // d2690 is seat 6 folding the turn after its own turn check, so k is 1.
    const csv = [
      'id,hand,ord,verdict',
      ...fixture.hands.flatMap((h) =>
        h.ords.map((ord) => `${h.ids[String(ord)]},${h.hand.handNumber},${ord},`)
      ),
    ].join('\n');
    const r = plo6Decisions(csv, fixture.hands.map((h) => JSON.stringify(h)).join('\n'));
    expect(r.unplaced).toEqual([]);
    expect(r.decisions).toHaveLength(12);
    expect(r.decisions.map((d) => [d.at?.id, nodeKey(d.node), d.recorded.action])).toContainEqual([
      'd2690',
      '59973455:6:turn:1',
      'fold',
    ]);
    expect(new Set(r.decisions.map((d) => d.recorded.action))).toEqual(new Set(['fold', 'call']));
    expect(r.decisions.every((d) => d.cls === 'unjudged')).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/spades|hearts|diamonds|clubs/);
  });

  it('the CLI reads --plo6, emits nodes with the audit id and ordinal, writes the Replay row, and exits 1 on a row it cannot place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audited-replay-plo6-'));
    try {
      const w = (name: string, text: string) => {
        writeFileSync(join(dir, name), text);
        return join(dir, name);
      };
      const hands = w('hands.jsonl', HANDS);
      const csv = w('decisions.csv', CSV);
      const run = (extra: string[]) =>
        spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            'scripts/audited-decision-replay.ts',
            '--plo6-hands',
            hands,
            ...extra,
          ],
          { cwd: SERVER_DIR, encoding: 'utf8', timeout: 240_000 }
        );
      const nodes = join(dir, 'nodes.jsonl');
      const emitted = run(['--plo6', csv, '--emit-nodes', nodes]);
      expect(emitted.status, emitted.stderr).toBe(0);
      expect(emitted.stdout).toContain('plo6: 6 audited decisions placed at a node, 0 not placed');
      const text = readFileSync(nodes, 'utf8');
      expect(JSON.parse(text.split('\n')[0])).toEqual({
        hand: '910001',
        seat: 2,
        street: 'flop',
        k: 1,
        id: 'd1',
        ord: 6,
        key: '910001:2:flop:1',
        source: 'plo6',
        recorded: { action: 'fold', amount: 0 },
        verdict: 'CLEAR',
      });
      expect(text).not.toMatch(/spades|hearts|diamonds|clubs/);

      const OPTION = 'plo6FacingBetIsPriced';
      expect(OPTION_SWITCH_ON_OFF_NAMES).toContain(OPTION);
      const replay = w(
        'replay.jsonl',
        [
          JSON.stringify({
            meta: {
              arms: { off: { options: { [OPTION]: 'off' } }, on: { options: { [OPTION]: 'on' } } },
            },
          }),
          JSON.stringify({
            hand: 910001,
            seat: 2,
            street: 'flop',
            k: 1,
            arms: { off: { action: 'fold' }, on: { action: 'call', amount: 3 } },
          }),
          JSON.stringify({
            hand: 910002,
            seat: 3,
            street: 'river',
            k: 1,
            arms: { off: { action: 'call', amount: 60 }, on: { action: 'call', amount: 60 } },
          }),
        ].join('\n')
      );
      const scored = run([
        '--plo6',
        csv,
        '--replay',
        replay,
        '--row',
        'on',
        '--set',
        'synthetic plo6',
        '--scorer-commit',
        'abcdef01234',
      ]);
      expect(scored.status, scored.stderr).toBe(0);
      expect(scored.stdout).toContain(`on vs base: ${OPTION}; differs from base on 1 of 2 rows`);
      expect(scored.stdout).toContain(
        '- Replay: fixed 1; newlyWrong 0; changed 1; unchanged 1; unjudged 0; set synthetic plo6; scorer abcdef01234; source plo6 verdict-only; arm on vs off; replayed 2 of 6'
      );

      const broken = run([
        '--plo6',
        w('broken.csv', `${CSV}\nd9,910001,4,,,,,CLEAR\n`),
        '--emit-nodes',
        join(dir, 'nodes2.jsonl'),
      ]);
      expect(broken.status).toBe(1);
      expect(broken.stdout).toContain(
        'not placed: row 8 decision d9 hand 910001 : the action at ord 4 is not a voluntary Horse decision'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
