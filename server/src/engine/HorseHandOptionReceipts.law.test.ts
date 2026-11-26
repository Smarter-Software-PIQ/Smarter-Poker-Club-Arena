/**
 * ===========================================================================
 *  LAW: A HAND'S OPTION RECEIPTS CARRY NO CARD AND NOTHING IS AWAITED FOR THEM
 * ===========================================================================
 *
 * Per-hand option receipts (2026-11-25, Hold'em Strategy lane): a listed Horse option that changes a decision
 * says so in the worker's reply, the table engine counts those per hand in memory, and the hand's existing
 * asynchronous save writes one row per (hand, receipt) to public.ca_horse_hand_receipts for hands a person was
 * dealt into. The Hold'em owner released the build on four conditions; this law pins the two that live in the
 * engine's source (the other two are the flag-off replay and the migration's own law):
 *
 *  A. NO CARD OF ANY KIND IN A RECEIPT. A receipt is an option name, the kind of action before and after, and on
 *     the row a count. The vocabulary is closed: six action words and `none`. Cards, boards, strengths, equities
 *     and amounts are refused at every step (out of the worker, into the hand's count, into the rows), whatever a
 *     caller hands in.
 *  B. NOTHING AWAITED ON THE TURN PATH. The decision path (HorseLogic.decide, the worker's FAST and DEEP
 *     executions) and the action path (the table engine's accepted-action block) gain no await, I/O or database
 *     call: the receipt module imports nothing and is synchronous; the brain and the worker executions hold no
 *     await at all; the table's count is one synchronous in-memory call; and the only database write is in the
 *     hand save, detached (`void`), after the hand's own commit, for hands with a person only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HAND_OPTION_RECEIPT_DECISIONS_MAX,
  HAND_OPTION_RECEIPT_KINDS,
  HAND_OPTION_RECEIPT_OPTIONS,
  HAND_OPTION_RECEIPT_ROW,
  HAND_OPTION_RECEIPTS_PER_DECISION_MAX,
  HAND_OPTION_RECEIPTS_PER_HAND_MAX,
  countHandOptionReceipts,
  handOptionReceiptKind,
  handOptionReceiptText,
  handOptionReceiptsOf,
  horseHandReceiptRows,
  handOptionReceiptCounts,
} from './HorseHandOptionReceipts.js';
import { DECISION_RULE_RECEIPTS_MAX } from './BrainTelemetry.js';

const SRC = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');
/** Source with comments removed, so a law reads code and not prose. */
const code = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const count = (haystack: string, needle: string | RegExp): number =>
  typeof needle === 'string'
    ? haystack.split(needle).length - 1
    : (
        haystack.match(
          new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)
        ) ?? []
      ).length;

const HAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** Things that must never be storable: cards, boards, strengths, equities, sizes. */
const CARD_LIKE = [
  'AsKd',
  'As',
  'Td9d8d',
  'QQ',
  'AKs',
  'top_pair',
  'nut_flush',
  '0.62',
  '62%',
  '4.5bb',
  '398',
  'call 40',
  'fold:AsKd',
  '',
  'CALL',
  ' call',
];

describe('A. no card of any kind in a receipt', () => {
  it('the vocabulary is closed: six action words, and only the listed options', () => {
    expect([...HAND_OPTION_RECEIPT_KINDS]).toEqual([
      'fold',
      'check',
      'call',
      'bet',
      'raise',
      'all_in',
    ]);
    expect([...HAND_OPTION_RECEIPT_OPTIONS]).toEqual([
      'holdemTournamentAllInCallIsPriced',
      'cashDefenceTrimColdCalls',
    ]);
    for (const k of HAND_OPTION_RECEIPT_KINDS) expect(handOptionReceiptKind(k)).toBe(k);
    for (const bad of [
      ...CARD_LIKE,
      null,
      undefined,
      7,
      0.62,
      {},
      ['call'],
      'none',
      'jam',
      'raiseTo',
    ])
      expect(handOptionReceiptKind(bad)).toBeNull();
  });

  it('out of the worker: only a listed option with two action words, and never the amount', () => {
    expect(handOptionReceiptsOf(undefined)).toBeUndefined();
    expect(handOptionReceiptsOf(null)).toBeUndefined();
    expect(handOptionReceiptsOf([])).toBeUndefined();
    // Another lane's rule receipts are not option receipts.
    expect(
      handOptionReceiptsOf([
        { receipt: 'omaha_turn_set_pound', before: null, after: { action: 'bet' } },
        { receipt: 'wager_rules.draw', before: { action: 'call' }, after: { action: 'fold' } },
      ])
    ).toBeUndefined();
    const withAmounts = [
      {
        receipt: 'cashDefenceTrimColdCalls',
        before: { action: 'call', amount: 4, cards: ['As', 'Kd'], equity: 0.62 },
        after: { action: 'fold', amount: null, strength: 'top_pair' },
        board: ['Td', '9d', '8d'],
      },
      { receipt: 'holdemTournamentAllInCallIsPriced', before: null, after: { action: 'all_in' } },
    ];
    const out = handOptionReceiptsOf(withAmounts as never)!;
    expect(out).toEqual([
      { option: 'cashDefenceTrimColdCalls', before: 'call', after: 'fold' },
      { option: 'holdemTournamentAllInCallIsPriced', before: null, after: 'all_in' },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/amount|cards|equity|strength|board|As|Kd|0\.62|\d/);
    for (const bad of CARD_LIKE) {
      expect(
        handOptionReceiptsOf([
          {
            receipt: 'cashDefenceTrimColdCalls',
            before: { action: bad },
            after: { action: 'fold' },
          },
          {
            receipt: 'cashDefenceTrimColdCalls',
            before: { action: 'call' },
            after: { action: bad },
          },
          { receipt: bad, before: { action: 'call' }, after: { action: 'fold' } },
        ])
      ).toBeUndefined();
    }
    // Bounded like the rule receipts it reads, and total on junk.
    expect(HAND_OPTION_RECEIPTS_PER_DECISION_MAX).toBe(DECISION_RULE_RECEIPTS_MAX);
    const many = Array.from({ length: 40 }, () => ({
      receipt: 'cashDefenceTrimColdCalls',
      before: { action: 'call' },
      after: { action: 'fold' },
    }));
    expect(handOptionReceiptsOf(many)!.length).toBe(HAND_OPTION_RECEIPTS_PER_DECISION_MAX);
    for (const junk of [7, 'x', {}, [null], [7], [{ receipt: 'cashDefenceTrimColdCalls' }]])
      expect(handOptionReceiptsOf(junk as never)).toBeUndefined();
  });

  it('into the hand: a reply is not trusted; only exact receipts are counted, once per decision', () => {
    const tally = new Map<string, number>();
    const good = { option: 'cashDefenceTrimColdCalls', before: 'call', after: 'fold' };
    countHandOptionReceipts(tally, [good, { ...good }]);
    countHandOptionReceipts(tally, [good]);
    countHandOptionReceipts(tally, [
      { option: 'holdemTournamentAllInCallIsPriced', before: null, after: 'call' },
    ]);
    expect(Object.fromEntries(tally)).toEqual({
      'cashDefenceTrimColdCalls:call>fold': 2,
      'holdemTournamentAllInCallIsPriced:none>call': 1,
    });
    const before = JSON.stringify([...tally]);
    for (const bad of CARD_LIKE) {
      countHandOptionReceipts(tally, [
        { option: 'cashDefenceTrimColdCalls', before: bad, after: 'fold' },
      ]);
      countHandOptionReceipts(tally, [
        { option: 'cashDefenceTrimColdCalls', before: 'call', after: bad },
      ]);
      countHandOptionReceipts(tally, [{ option: bad, before: 'call', after: 'fold' }]);
      expect(
        handOptionReceiptText({ option: 'cashDefenceTrimColdCalls', before: bad, after: 'fold' })
      ).toBeNull();
    }
    for (const junk of [
      undefined,
      null,
      7,
      'cashDefenceTrimColdCalls:call>fold',
      {},
      [null, 7, 'x', []],
    ])
      countHandOptionReceipts(tally, junk);
    countHandOptionReceipts(tally, [{ option: 'someOtherOption', before: 'call', after: 'fold' }]);
    countHandOptionReceipts(tally, [{ option: 'cashDefenceTrimColdCalls', before: 'call' }]);
    countHandOptionReceipts(tally, [
      { option: 'cashDefenceTrimColdCalls', before: undefined, after: 'fold' },
    ]);
    expect(JSON.stringify([...tally])).toBe(before);
    // Every key the count can ever hold is the closed row text.
    for (const key of tally.keys()) expect(key).toMatch(HAND_OPTION_RECEIPT_ROW);
    // Bounded: a hand holds at most the finite set of texts, and a count never passes the cap.
    const full = new Map<string, number>();
    for (let i = 0; i < HAND_OPTION_RECEIPT_DECISIONS_MAX + 50; i++)
      countHandOptionReceipts(full, [good]);
    expect(full.get('cashDefenceTrimColdCalls:call>fold')).toBe(HAND_OPTION_RECEIPT_DECISIONS_MAX);
    for (const option of HAND_OPTION_RECEIPT_OPTIONS)
      for (const b of [null, ...HAND_OPTION_RECEIPT_KINDS])
        for (const a of HAND_OPTION_RECEIPT_KINDS)
          countHandOptionReceipts(full, [{ option, before: b, after: a }]);
    expect(full.size).toBeLessThanOrEqual(HAND_OPTION_RECEIPTS_PER_HAND_MAX);
  });

  it('into the rows: three fields, and a text that is not exactly a receipt is never a row', () => {
    const rows = horseHandReceiptRows(HAND, {
      'cashDefenceTrimColdCalls:call>fold': 2,
      'holdemTournamentAllInCallIsPriced:none>all_in': 5000,
    });
    expect(rows).toEqual([
      { hand_id: HAND, receipt: 'cashDefenceTrimColdCalls:call>fold', decisions: 2 },
      {
        hand_id: HAND,
        receipt: 'holdemTournamentAllInCallIsPriced:none>all_in',
        decisions: HAND_OPTION_RECEIPT_DECISIONS_MAX,
      },
    ]);
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual(['decisions', 'hand_id', 'receipt']);
    const bad: Record<string, number> = { 'someOtherOption:call>fold': 1 };
    for (const c of CARD_LIKE) {
      bad[`cashDefenceTrimColdCalls:${c}>fold`] = 1;
      bad[`cashDefenceTrimColdCalls:call>${c}`] = 1;
      bad[`cashDefenceTrimColdCalls:call>fold ${c}`] = 1;
      bad[`cashDefenceTrimColdCalls:call>fold\n${c}`] = 1;
    }
    expect(horseHandReceiptRows(HAND, bad)).toEqual([]);
    expect(horseHandReceiptRows(HAND, { 'cashDefenceTrimColdCalls:call>fold': 0 })).toEqual([]);
    expect(horseHandReceiptRows(HAND, { 'cashDefenceTrimColdCalls:call>fold': 1.5 })).toEqual([]);
    expect(horseHandReceiptRows('', { 'cashDefenceTrimColdCalls:call>fold': 1 })).toEqual([]);
    expect(horseHandReceiptRows(HAND, null)).toEqual([]);
    expect(horseHandReceiptRows(HAND, undefined)).toEqual([]);
  });

  it('the two options record action words only where they change the action (no amount is handed over)', () => {
    const logic = code('engine/HorseLogic.ts');
    for (const option of HAND_OPTION_RECEIPT_OPTIONS) {
      const calls = logic.match(
        new RegExp(`noteDecisionRuleReceipt\\(\\s*'${option}',[\\s\\S]*?\\);`, 'g')
      );
      expect(calls, option).not.toBeNull();
      for (const call of calls!) {
        // Each side is exactly `{ action: <expr> }`: one key, no amount, no cards.
        const sides = call.match(/\{[^{}]*\}/g)!;
        expect(sides.length, call).toBe(2);
        for (const side of sides) expect(side.trim(), call).toMatch(/^\{ action: [^,{}]+ \}$/);
        expect(call).not.toMatch(/amount|cards|equity|strength|board/i);
      }
    }
    // Nothing else in the engine records a receipt under an option's name.
    expect(count(logic, /noteDecisionRuleReceipt\(\s*'holdemTournamentAllInCallIsPriced'/)).toBe(2);
    expect(count(logic, /noteDecisionRuleReceipt\(\s*'cashDefenceTrimColdCalls'/)).toBe(1);
  });
});

describe('B. nothing awaited on the turn path', () => {
  it('the receipt module imports nothing and is synchronous: it cannot reach I/O', () => {
    const module = code('engine/HorseHandOptionReceipts.ts');
    expect(module).not.toMatch(/\bimport\b|\brequire\s*\(/);
    expect(module).not.toMatch(
      /\bawait\b|\basync\b|\bPromise\b|\.then\(|setTimeout|setImmediate|queueMicrotask|\bfetch\b|supabase|process\.|\bfs\b/
    );
  });

  it('the brain holds no await at all, so the two receipt sites cannot have added one', () => {
    for (const file of [
      'engine/HorseLogic.ts',
      'engine/HorsePreflop.ts',
      'engine/HorseGtoDefenceRanges.ts',
    ])
      expect(count(code(file), /\bawait\b/), file).toBe(0);
    const telemetry = code('engine/BrainTelemetry.ts');
    expect(count(telemetry, /\bawait\b|\basync\b/)).toBe(0);
    // The brain does not import the receipt module at all (its reference-source digests are untouched): it only
    // records two action words through BrainTelemetry, as every receipted rule does.
    const logic = code('engine/HorseLogic.ts');
    expect(logic).not.toMatch(/HorseHandOptionReceipts/);
    expect(logic).not.toMatch(/HorseHandReceipts\.js|ca_horse_hand_receipts/);
    // The cold-call trim's "before" is a rewound intent (RNG restored, telemetry suspended), built only with
    // the option on and telemetry on; with the option off none of it runs.
    expect(logic).toMatch(/if \(trimColdCalls && telemetryOn\(opts\)\) \{/);
    expect(logic).toMatch(
      /const trimOffIntent =\s*gtoDefend72TrimOff !== undefined\s*\? rewound15\(\{/
    );
    expect(logic).toMatch(
      /const trimColdCalls = defend85 && opts\.cashDefenceTrimColdCalls === true;/
    );
  });

  it('the worker reads the receipts the decision already recorded: no await in FAST or DEEP, no new I/O', () => {
    const worker = code('engine/horseDecision/workerRuntime.ts');
    /** One method's own text: from its header to the next member of the class. */
    const method = (name: string): string => {
      const from = worker.indexOf(`  private ${name}(`);
      expect(from, name).toBeGreaterThan(0);
      const rest = worker.slice(from + 10);
      const next = rest.search(/\n  (?:private|protected|public|static|async|get|set) /);
      return worker.slice(from, from + 10 + (next < 0 ? rest.length : next));
    };
    const fast = method('executeFast');
    const deep = method('executeDeep');
    expect(fast.length).toBeGreaterThan(1000);
    expect(deep.length).toBeGreaterThan(1000);
    expect(count(fast, /\bawait\b/)).toBe(0);
    expect(count(deep, /\bawait\b/)).toBe(0);
    expect(
      count(fast, 'const optionReceipts = handOptionReceiptsOf(decisionRuleReceiptsSoFar());')
    ).toBe(1);
    expect(count(fast, '...(optionReceipts ? { optionReceipts } : {}),')).toBe(1);
    expect(
      count(deep, 'const deepOptionReceipts = handOptionReceiptsOf(secondLook.ruleReceipts);')
    ).toBe(1);
    expect(
      count(deep, '...(deepOptionReceipts ? { optionReceipts: deepOptionReceipts } : {}),')
    ).toBe(1);
    // The reply field exists only behind those two conditional spreads: absent when nothing fired.
    expect(count(fast, /\boptionReceipts\b/)).toBe(3);
    expect(count(deep, /\boptionReceipts\b/)).toBe(1);
    expect(count(worker, /\boptionReceipts\b/)).toBe(4);
    expect(worker).not.toMatch(/HorseHandReceipts\.js|ca_horse_hand_receipts/);
  });

  it('the table counts an accepted decision in memory, synchronously, and never writes on the turn', () => {
    const turns = code('engine/ServerTableEngineTurns.ts');
    expect(turns).not.toMatch(
      /HorseHandReceipts\.js|ca_horse_hand_receipts|writeHorseHandReceipts/
    );
    expect(count(turns, 'countHandOptionReceipts(')).toBe(1);
    const at = turns.indexOf(
      'countHandOptionReceipts(this.currentHandOptionReceipts, pendingOptionReceipts);'
    );
    expect(at).toBeGreaterThan(0);
    expect(turns.slice(at - 40, at)).not.toMatch(/\bawait\b|\bvoid\b|\.then\(/);
    // It sits in the synchronous accepted-action block, right where the executed action is recorded.
    const barrier = turns.lastIndexOf('worker.runWithDispatchBarrier(() => {', at);
    expect(barrier).toBeGreaterThan(0);
    const between = turns.slice(barrier, at);
    expect(count(between, /\bawait\b/)).toBe(0);
    expect(between).toMatch(
      /intendedApplied = applied;\s*if \(applied\) \{\s*executedAction = action as ActionType;\s*executedAmount = normalizedAmount;\s*$/
    );
    // What is counted is what the executed decision's own reply carried: the FAST reply, or the second look's
    // when its decision replaced it.
    expect(count(turns, 'pendingOptionReceipts = fastResult.optionReceipts;')).toBe(1);
    expect(count(turns, 'pendingOptionReceipts = deepResult.optionReceipts;')).toBe(1);
    // The count is per hand: cleared at the deal, copied into the settlement snapshot.
    expect(
      count(
        code('engine/ServerTableEngineDealing.ts'),
        'this.currentHandOptionReceipts = new Map();'
      )
    ).toBe(1);
    const settlement = code('engine/ServerTableEngineSettlement.ts');
    expect(settlement).toMatch(
      /horseOptionReceipts:\s*this\.currentHandOptionReceipts instanceof Map && this\.currentHandOptionReceipts\.size > 0\s*\? \(Object\.fromEntries\(this\.currentHandOptionReceipts\) as Record<string, number>\)\s*: undefined,/
    );
    expect(settlement).not.toMatch(/HorseHandOptionReceipts/);
    // Lightning's copy is the module's total one: a count that is missing, empty or holds anything but
    // receipt texts gives nothing.
    expect(handOptionReceiptCounts(undefined)).toBeUndefined();
    expect(handOptionReceiptCounts(new Map())).toBeUndefined();
    expect(handOptionReceiptCounts({ size: 3 })).toBeUndefined();
    const held = new Map<unknown, unknown>([
      ['cashDefenceTrimColdCalls:call>fold', 2],
      ['cashDefenceTrimColdCalls:AsKd>fold', 1],
      ['holdemTournamentAllInCallIsPriced:fold>call', 'x'],
      [7, 1],
    ]);
    expect(handOptionReceiptCounts(held)).toEqual({ 'cashDefenceTrimColdCalls:call>fold': 2 });
    expect(held.size).toBe(4);
    expect(count(settlement, 'horseOptionReceipts: snap.horseOptionReceipts,')).toBe(1);
    expect(settlement).not.toMatch(/writeHorseHandReceipts|ca_horse_hand_receipts/);
  });

  it('Lightning does the same: a landed Horse action is counted in memory, and the write follows its settlement', () => {
    const host = code('lightning/LightningHandHost.ts');
    expect(host).not.toMatch(/ca_horse_hand_receipts/);
    // Two places a Horse decision lands (the acted decision, the Lightning fast fold): one synchronous call each.
    const counts = [...host.matchAll(/countHandOptionReceipts\(this\.optionReceipts, [^)]*\);/g)];
    expect(counts.map((m) => m[0])).toEqual([
      'countHandOptionReceipts(this.optionReceipts, decision.fast?.optionReceipts);',
      'countHandOptionReceipts(this.optionReceipts, fast?.optionReceipts);',
    ]);
    expect(count(host, 'countHandOptionReceipts(')).toBe(2);
    for (const m of counts)
      expect(host.slice(m.index! - 60, m.index!)).not.toMatch(/\bawait\b|\bvoid\b|\.then\(/);
    expect(host).toMatch(/applied = r\.success;\s*if \(r\.success\) countHandOptionReceipts\(/);
    // One detached write, after the settlement answered with the committed hand, for hands with a person.
    expect(count(host, 'writeHorseHandReceipts(')).toBe(1);
    expect(host).not.toMatch(/await\s+writeHorseHandReceipts/);
    expect(host).toMatch(
      /if \(handWritesOptionReceipts\(this\.hasHumanParticipant\(\), optionReceipts\)\)\s*void writeHorseHandReceipts\(out\.value\.handHistoryId, optionReceipts\);/
    );
    expect(host.indexOf('void writeHorseHandReceipts(')).toBeGreaterThan(
      host.indexOf('await this.deps.backend.settle(')
    );
  });

  it('the one database write is in the hand save: detached, after the commit, for hands with a person', () => {
    const save = code('services/supabase/handHistory.ts');
    expect(count(save, 'writeHorseHandReceipts(')).toBe(1);
    expect(save).not.toMatch(/await\s+writeHorseHandReceipts/);
    expect(save).toMatch(
      /if \(\s*handId &&\s*inserted\.settlementCommitted &&\s*handWritesOptionReceipts\(rosterHasHuman, params\.horseOptionReceipts\)\s*\)\s*void writeHorseHandReceipts\(handId, params\.horseOptionReceipts\);/
    );
    // It follows the commit (the `inserted` receipt exists) and the receipts never enter the hand row.
    expect(save.indexOf('void writeHorseHandReceipts(')).toBeGreaterThan(
      save.indexOf('insertHandHistoryRow(')
    );
    expect(count(save, 'horseOptionReceipts')).toBe(3);
    const writer = code('services/HorseHandReceipts.ts');
    expect(writer).toMatch(/rosterHasHuman === true/);
    expect(writer).toContain(
      ".upsert(rows, { onConflict: 'hand_id,receipt', ignoreDuplicates: true })"
    );
    expect(writer).not.toMatch(/\.update\(|\.delete\(|\.rpc\(/);
    expect(writer).toContain('const rows = horseHandReceiptRows(handId, counts);');
    // Only the hand save calls the writer, and only the writer names the table.
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const grep = (needle: string): string[] =>
      spawnSync('git', ['grep', '-l', '-F', needle, '--', 'src', ':!src/**/*.test.ts'], {
        cwd: resolve(SRC, '..'),
        encoding: 'utf8',
      })
        .stdout.split('\n')
        .filter(Boolean)
        .sort();
    expect(grep('writeHorseHandReceipts')).toEqual([
      // a test harness that runs the extracted hand save in a VM with an inert writer
      'src/engine/OriginalPayloadRetry.runtime.mjs',
      'src/lightning/LightningHandHost.ts',
      'src/services/HorseHandReceipts.ts',
      'src/services/supabase/handHistory.ts',
    ]);
    expect(grep('ca_horse_hand_receipts')).toEqual([
      'src/engine/HorseHandOptionReceipts.ts',
      'src/services/HorseHandReceipts.ts',
      'src/services/supabase/handHistory.ts',
    ]);
  });
});
