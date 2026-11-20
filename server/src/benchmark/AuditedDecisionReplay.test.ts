/**
 * The audited-decision replay scorer joins by decision node, judges with the audit's own rules and splits
 * every outcome by rule receipt. Every row below is synthetic and anonymized (hand ids 9000xx, seat names
 * h1..h3, no real hole cards); only the column layouts are the audits' real formats.
 */
import { describe, expect, it } from 'vitest';
import {
  audit2Decisions,
  judgeAudit2,
  nodeKey,
  parseCsv,
  parseReplayJsonl,
  replayBarLine,
  scoreReplay,
  wooWooDecisions,
  type Audit2JudgeInputs,
} from './AuditedDecisionReplay.js';

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
