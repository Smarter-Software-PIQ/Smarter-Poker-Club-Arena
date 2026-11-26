import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GROUP_NAMES,
  GROUP_PLANS,
  applyVariants,
  augmentState,
  classifyAgainst,
  comparisonRefused,
  diffDecisions,
  formatDiffReport,
  groupByReceipt,
  handPlan,
  headerWarnings,
  jsonPaths,
  keepsCapturedDecision,
  optionRowsFromJson,
  parseVariant,
  planTargets,
  receiptDelta,
  receiptSignature,
  stateCarriesMemory,
  syntheticMemoryHands,
} from '../../scripts/ops/horse-decision-crossbuild-replay-lib.mjs';

const ROOT = path.resolve(__dirname, '../..');

/** One replay row: decision JSON `d` with receipts `fires`. */
function row(k, seed, d, fires = ['decide:1'], extra = {}) {
  return {
    k,
    seed,
    group: k.split(':')[0],
    sub: '2max/100bb/hybrid',
    tags: [],
    mem: null,
    stage: 'preflop',
    action: d.action,
    amount: d.amount ?? null,
    j: JSON.stringify(d),
    fires,
    ...extra,
  };
}
const fold = { action: 'fold', thinkTime: 900 };
const call = { action: 'call', amount: 12, thinkTime: 900 };

describe('cross-build replay: the comparison', () => {
  it('reports 0 differences when action, amount, decision JSON and receipts all match', () => {
    const rows = [
      row('plo4_cash_hu:1:1', 1, fold),
      row('plo4_cash_hu:1:1', 2, call),
      row('nlh_cash:9:4', 1, call),
    ];
    const diff = diffDecisions({ head: rows, base: rows.map((r) => ({ ...r })) });
    expect(diff.differences).toBe(0);
    expect(diff.totals.compared).toBe(3);
    expect(diff.totals.identical).toBe(3);
    expect(formatDiffReport(diff).split('\n')[0]).toMatch(/^0 differences \(3 decisions compared/);
  });

  it('separates an action change, an amount change, a JSON-only change and a receipts-only change', () => {
    const base = [
      row('plo5_cash_hu:1:1', 1, fold),
      row('plo5_cash_hu:1:2', 1, call),
      row('plo5_cash_hu:1:3', 1, call),
      row('plo5_cash_hu:1:4', 1, call),
      row('plo5_cash_hu:1:5', 1, call),
    ];
    const head = [
      row('plo5_cash_hu:1:1', 1, call, ['decide:1', 'omaha_preflop_reraise_defence_call:1']),
      row('plo5_cash_hu:1:2', 1, { ...call, amount: 14 }),
      row('plo5_cash_hu:1:3', 1, { ...call, thinkTime: 1200 }),
      row('plo5_cash_hu:1:4', 1, call, ['decide:1', 'some_receipt:1']),
      row('plo5_cash_hu:1:5', 1, call),
    ];
    const diff = diffDecisions({ head, base });
    expect(diff.differences).toBe(4);
    expect(diff.totals).toMatchObject({
      actionAmountDiffs: 2,
      actionDiffs: 1,
      amountOnlyDiffs: 1,
      jsonOnlyDiffs: 1,
      receiptsOnlyDiffs: 1,
      identical: 1,
    });
    expect(diff.examples.map((e) => e.kind).sort()).toEqual([
      'action',
      'amount',
      'json',
      'receipts',
    ]);
    expect(diff.examples.find((e) => e.kind === 'json').paths).toEqual(['.thinkTime']);
    expect(formatDiffReport(diff).split('\n')[0]).toMatch(/^4 differences in 5 decisions compared/);
  });

  it('counts a decision present in one replay only, and an error on one build only, as differences', () => {
    const base = [
      row('nlh_cash:1:1', 1, call),
      row('nlh_cash:1:2', 1, call),
      { k: 'nlh_cash:1:3', seed: 1, group: 'nlh_cash', error: 'TypeError: x' },
    ];
    const head = [
      row('nlh_cash:1:1', 1, call),
      { k: 'nlh_cash:1:2', seed: 1, group: 'nlh_cash', error: 'TypeError: y' },
      { k: 'nlh_cash:1:3', seed: 1, group: 'nlh_cash', error: 'TypeError: x' },
      row('nlh_cash:1:9', 1, call),
    ];
    const diff = diffDecisions({ head, base });
    expect(diff.totals).toMatchObject({ missing: 1, errorDiffs: 1, bothErrored: 1, identical: 1 });
    expect(diff.differences).toBe(2);
    // the same error on both builds says nothing, and the report says so
    expect(formatDiffReport(diff)).toContain(
      'decide threw the same error on both builds for 1 decisions'
    );
  });

  it('flags opponent history that one build could not seed', () => {
    const base = [
      row('plo4_cash_hu:1:1', 1, call, ['decide:1'], {
        mem: 'unavailable',
        tags: ['opponent_memory'],
      }),
    ];
    const head = [
      row('plo4_cash_hu:1:1', 1, call, ['decide:1'], { mem: 'seeded', tags: ['opponent_memory'] }),
    ];
    const diff = diffDecisions({ head, base });
    expect(diff.totals.memoryStatusDiffs).toBe(1);
    expect(diff.differences).toBe(1);
  });

  it('names the JSON paths that differ, folding array indexes', () => {
    // first argument is the base decision, second the head decision
    expect(
      jsonPaths(
        { a: 1, t: [{ x: 1 }, { x: 2 }], only: 1 },
        { a: 2, t: [{ x: 1 }, { x: 3 }], more: 1 }
      )
    ).toEqual(['.a', '.t[].x', '.only (only base)', '.more (only head)']);
  });
});

describe('cross-build replay: grouping by receipt', () => {
  it('reads receipts as names only one side fired, else names fired a different number of times', () => {
    const delta = receiptDelta(
      ['a:1', 'b:5', 'new_rule_call:1'],
      ['a:1', 'b:4', 'old_rule_retained:1']
    );
    expect(delta).toEqual({
      onlyHead: ['new_rule_call'],
      onlyBase: ['old_rule_retained'],
      countChanged: ['b'],
    });
    expect(receiptSignature(delta)).toBe('head only: new_rule_call | base only: old_rule_retained');
    expect(receiptSignature(receiptDelta(['b:5'], ['b:4']))).toBe(
      'fired a different number of times: b'
    );
    expect(receiptSignature(receiptDelta(['b:5'], ['b:5']))).toBe('(no receipt difference)');
  });

  it('groups differing decisions under one signature, largest group first, with the fold -> call tally', () => {
    const base = [];
    const head = [];
    for (let i = 0; i < 5; i++) {
      base.push(
        row(`plo5_cash_hu:7:${i}`, 1, fold, ['decide:1', 'phase15_node_wager_rules_retained:1'])
      );
      head.push(
        row(`plo5_cash_hu:7:${i}`, 1, call, [
          'decide:1',
          'omaha_preflop_reraise_defence_call:1',
          'phase15_node_wager_rules_changed:1',
        ])
      );
    }
    base.push(
      row('plo5_cash_hu:7:0', 2, fold, ['decide:1', 'phase15_node_wager_rules_retained:1'])
    );
    head.push(
      row('plo5_cash_hu:7:0', 2, call, [
        'decide:1',
        'omaha_preflop_reraise_defence_call:1',
        'phase15_node_wager_rules_changed:1',
      ])
    );
    base.push(row('nlh_cash:3:1', 1, call, ['decide:1']));
    head.push(
      row('nlh_cash:3:1', 1, { action: 'raise', amount: 30 }, ['decide:1', 'other_rule:1'])
    );
    const diff = diffDecisions({ head, base });
    expect(diff.byReceipt).toHaveLength(2);
    const [big, small] = diff.byReceipt;
    expect(big.signature).toBe(
      'head only: omaha_preflop_reraise_defence_call, phase15_node_wager_rules_changed | base only: phase15_node_wager_rules_retained'
    );
    expect(big).toMatchObject({
      decisions: 6,
      states: 5,
      kinds: { action: 6 },
      groups: { plo5_cash_hu: 6 },
      transitions: { 'fold -> call': 6 },
    });
    expect(small).toMatchObject({ decisions: 1, states: 1, signature: 'head only: other_rule' });
    expect(groupByReceipt(diff.examples).map((g) => g.decisions)).toEqual([6, 1]);
    const report = formatDiffReport(diff);
    expect(report).toContain('Differing decisions grouped by receipt (2 groups):');
    expect(report).toContain(
      '1. 6 decisions in 5 states - head only: omaha_preflop_reraise_defence_call'
    );
    expect(report).toContain('base -> head: fold -> call 6');
  });

  it('marks the synthetic bomb-pot groups as weak evidence in the printed table', () => {
    const rows = [row('bombsrc_plo4:1:1', 1, call), row('plo4_cash_hu:1:1', 1, call)];
    const report = formatDiffReport(diffDecisions({ head: rows, base: rows }));
    expect(report).toMatch(/bombsrc_plo4 .*WEAK \(synthetic bomb pot \/ double board\)/);
    expect(report).not.toMatch(/plo4_cash_hu .*WEAK/);
    expect(
      Object.entries(GROUP_PLANS)
        .filter(([, p]) => p.weak)
        .map(([g]) => g)
    ).toEqual(['bombsrc_plo4', 'bombsrc_plo5']);
  });
});

describe('cross-build replay: headers', () => {
  const header = (over = {}) => ({
    node: 'v22.23.3',
    build: { commit: 'a'.repeat(40), dirtyFiles: 0 },
    stateSet: { id: 'quick@abc/1/2940:all:2940' },
    seeds: [1, 20261122],
    augmentVersion: 2,
    memory: 'some',
    memoryHands: 60,
    memoryStatus: { seeded: 10, error: 0, unavailable: 0, firstError: null },
    options: {
      rowsDigest: 'd1',
      variants: [],
      received: { a: true, b: false },
      source: { schema: 'horse-option-switch-state/v1', asOfUtc: '2026-11-23T05:05:00.000Z' },
    },
    missingParts: [],
    ...over,
  });

  it('refuses to compare replays of different states, seeds or input variations', () => {
    expect(comparisonRefused(header(), header())).toBe(false);
    expect(comparisonRefused(header(), header({ stateSet: { id: 'other' } }))).toBe(true);
    expect(comparisonRefused(header(), header({ seeds: [1] }))).toBe(true);
    expect(comparisonRefused(header(), header({ memory: 'off' }))).toBe(true);
    expect(comparisonRefused(header(), null)).toBe(true);
  });

  it('says which options only one build received, a Node mismatch and unseeded history', () => {
    const base = header({
      node: 'v26.3.0',
      options: { ...header().options, received: { a: true } },
      memoryStatus: { seeded: 0, error: 0, unavailable: 10, firstError: null },
      missingParts: ['readScopeOf'],
    });
    const w = headerWarnings(header(), base).join('\n');
    expect(w).toContain('different Node versions (v22.23.3 vs v26.3.0)');
    expect(w).toContain(
      'options only the head build received (the base build does not know them): b=false'
    );
    expect(w).toContain('opponent history could not be seeded on the base build for 10 decisions');
    expect(w).toContain('the base build has no readScopeOf');
    expect(comparisonRefused(header(), base)).toBe(false);
  });

  it('prints the commit and Node version of both builds', () => {
    const rows = [row('nlh_cash:1:1', 1, call)];
    const report = formatDiffReport(diffDecisions({ head: rows, base: rows }), {
      headHeader: header(),
      baseHeader: header({ build: { commit: 'b'.repeat(40), dirtyFiles: 0 } }),
    });
    expect(report).toContain(`head: commit ${'a'.repeat(40)}, Node v22.23.3`);
    expect(report).toContain(`base: commit ${'b'.repeat(40)}, Node v22.23.3`);
  });
});

describe('cross-build replay: options', () => {
  it('reads the production switch snapshot kept in the repo', () => {
    const { rows, source } = optionRowsFromJson(
      JSON.parse(readFileSync(path.join(ROOT, 'docs/horse-option-switch-state.json'), 'utf8'))
    );
    expect(source.schema).toBe('horse-option-switch-state/v1');
    expect(source.asOfUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(rows).length).toBeGreaterThan(50);
    expect(new Set(Object.values(rows)).has('on')).toBe(true);
  });

  it('reads plain rows and refuses a file without usable states', () => {
    expect(optionRowsFromJson({ rows: { a: 'on', b: 'off' } }).rows).toEqual({ a: 'on', b: 'off' });
    expect(() => optionRowsFromJson({ rows: { a: 'maybe' } })).toThrow(/no usable state/);
    expect(() => optionRowsFromJson({})).toThrow(/no "rows"/);
  });

  it('applies a named variant to the rows and keeps a raw option apart', () => {
    expect(parseVariant('+omahaStreetPlan=on')).toEqual({
      kind: 'row',
      name: 'omahaStreetPlan',
      state: 'on',
    });
    expect(parseVariant('omahaStreetPlan=off')).toEqual({
      kind: 'row',
      name: 'omahaStreetPlan',
      state: 'off',
    });
    expect(parseVariant('+raw:someOption=true')).toEqual({
      kind: 'raw',
      name: 'someOption',
      value: true,
    });
    expect(() => parseVariant('+omahaStreetPlan=maybe')).toThrow(/state must be one of/);
    const v = applyVariants({ a: 'on', b: 'off' }, ['+b=on', '+raw:c=0.5']);
    expect(v).toEqual({ rows: { a: 'on', b: 'on' }, raw: { c: 0.5 }, expect: { b: 'on' } });
  });
});

describe('cross-build replay: the state set and its input variations', () => {
  it('sizes the quick set at about 3,000 states and the full set at the 2026-11-22 count', () => {
    const sum = (t) => Object.values(t).reduce((a, b) => a + b, 0);
    expect(sum(planTargets('full'))).toBe(14000);
    expect(sum(planTargets('quick'))).toBeGreaterThan(2800);
    expect(sum(planTargets('quick'))).toBeLessThan(3200);
    expect(Object.keys(planTargets('quick'))).toEqual(GROUP_NAMES);
    expect(planTargets('quick', 0.01, ['plo5_cash_hu'])).toEqual({ plo5_cash_hu: 12 });
    expect(() => planTargets('huge')).toThrow(/unknown state set/);
    expect(() => planTargets('quick', null, ['plo9'])).toThrow(/unknown group/);
  });

  it('covers PLO4/PLO5/PLO6 cash, PLO4/PLO5 tournaments, NLH cash and tournament, and Lightning', () => {
    const kinds = new Set(
      GROUP_NAMES.map((g) => `${GROUP_PLANS[g].variant}/${GROUP_PLANS[g].mode}`)
    );
    for (const k of [
      'plo4/cash',
      'plo5/cash',
      'plo6/cash',
      'plo4/tournament',
      'plo5/tournament',
      'nlh/cash',
      'nlh/tournament',
    ])
      expect(kinds.has(k)).toBe(true);
    expect(GROUP_NAMES.filter((g) => g.startsWith('lightning_'))).toHaveLength(3);
  });

  it('deals the same hand plan for the same index', () => {
    expect(handPlan('plo4_tourn', 2)).toEqual(handPlan('plo4_tourn', 2));
    expect(handPlan('plo4_tourn', 2)).toMatchObject({
      seed: 410002,
      seats: 2,
      kind: 'hu',
      hybrid: false,
      variant: 'plo4',
      mode: 'tournament',
    });
    expect(handPlan('plo5_cash_6max', 0)).toMatchObject({
      seed: 210000,
      seats: 6,
      stackBB: 100,
      kind: null,
      hybrid: true,
    });
    expect(keepsCapturedDecision('flop', 5, 1, 6)).toBe(true);
    expect([0, 1, 2, 3].filter((n) => keepsCapturedDecision('preflop', 4, n, 6))).toHaveLength(1);
  });

  const state = (group, stage = 'preflop') => ({
    k: `${group}:1:1`,
    group,
    seed: 1,
    player: {
      seat: 1,
      user_id: 'league-1',
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'spades' },
      ],
    },
    gs: {
      gameMode: 'cash',
      stage,
      bigBlind: 2,
      communityCards:
        stage === 'preflop'
          ? []
          : [
              { rank: '2', suit: 'clubs' },
              { rank: '7', suit: 'hearts' },
              { rank: 'T', suit: 'diamonds' },
            ],
      players: [1, 2, 3].map((s) => ({ seat: s, user_id: `league-${s}`, is_folded: false })),
    },
  });

  it('applies the same variations to the same state and index, whatever the build', () => {
    const a = state('plo5_cash_hu');
    const b = state('plo5_cash_hu');
    expect(augmentState(a, 3)).toEqual(augmentState(b, 3));
    expect(a).toEqual(b);
    expect(a.gs.humanUserIds).toEqual(['league-2']);
    expect(a.gs.vpipFloor).toBe(50);
    expect(augmentState(state('plo5_cash_hu'), 2)).toEqual(['opponent_memory']);
    expect(augmentState(state('plo5_cash_hu'), 2, { memory: 'off' })).toEqual([]);
    expect(augmentState(state('lightning_nlh'), 4).includes('lightning')).toBe(true);
    const bomb = state('bombsrc_plo4', 'flop');
    expect(augmentState(bomb, 4)).toContain('bomb_double_board');
    expect(bomb.gs.communityCards2).toHaveLength(3);
    expect(bomb.gs.boardCount).toBe(2);
    // a recorded production request is replayed as recorded
    expect(augmentState(state('journal_real'), 3)).toEqual([]);
  });

  it('carries opponent history on one state in four by default', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((i) => stateCarriesMemory(i))).toEqual([2, 6]);
    expect(stateCarriesMemory(2, 'off')).toBe(false);
    expect(stateCarriesMemory(1, 'all')).toBe(true);
  });

  it('builds the same synthetic opponent history from the same state, in the engine history layout', () => {
    const hands = syntheticMemoryHands(state('plo5_cash_6max'), { hands: 40 });
    expect(hands).toEqual(syntheticMemoryHands(state('plo5_cash_6max'), { hands: 40 }));
    expect(hands).toHaveLength(40);
    const all = hands.flatMap((h) => h.history);
    for (const a of all) {
      expect(
        Object.keys(a)
          .filter((k) => k !== 'isFullRaise')
          .sort()
      ).toEqual(['action', 'amount', 'seat', 'stage', 'timestamp', 'userId']);
      expect(['fold', 'call', 'raise', 'bet', 'check']).toContain(a.action);
    }
    // every seat acts, raises and folds occur, some hands reach a later street and a showdown
    expect(new Set(all.map((a) => a.userId)).size).toBe(3);
    expect(all.some((a) => a.action === 'raise' && a.stage === 'preflop')).toBe(true);
    expect(all.some((a) => a.stage === 'river')).toBe(true);
    expect(hands.some((h) => h.showdown)).toBe(true);
    expect(new Set(all.map((a) => a.timestamp)).size).toBe(all.length);
    // another state gives another history
    const other = { ...state('plo5_cash_6max'), k: 'plo5_cash_6max:2:1' };
    expect(syntheticMemoryHands(other, { hands: 40 })).not.toEqual(hands);
  });
});

describe('cross-build replay: the bisect step', () => {
  it('tells a mid build that decides like the base from one that decides like the head', () => {
    const base = [row('a:1:1', 1, fold), row('a:1:2', 1, fold)];
    const head = [row('a:1:1', 1, call), row('a:1:2', 1, call)];
    expect(classifyAgainst(base, base, head).verdict).toBe('base');
    expect(classifyAgainst(head, base, head).verdict).toBe('head');
    expect(classifyAgainst([head[0], base[1]], base, head)).toMatchObject({
      likeBase: 1,
      likeHead: 1,
      verdict: 'mixed',
    });
  });
});

describe('horse-flag-off-check.sh refuses before it creates anything', () => {
  const script = path.join(ROOT, 'scripts/ops/horse-flag-off-check.sh');
  const run = (args, env = {}) =>
    spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, HORSE_FLAG_OFF_SCRATCH: '', ...env },
    });

  it('exits 2 without two refs or without a scratch directory (it never picks one itself)', () => {
    expect(run([]).status).toBe(2);
    const noScratch = run(['HEAD', 'HEAD']);
    expect(noScratch.status).toBe(2);
    expect(noScratch.stderr).toContain('give --scratch');
    expect(
      run(['HEAD', 'HEAD', '--scratch', path.join(ROOT, 'no-such-dir-for-this-test')]).status
    ).toBe(2);
  });

  it('names the boot-drive refusal, the worktree removal and that it is not a required check', () => {
    const text = readFileSync(script, 'utf8');
    expect(text).toContain('is on the boot drive');
    expect(text).toContain('worktree remove --force');
    expect(text).toContain('It is NOT a required check');
    expect(text).not.toMatch(/--no-verify|git stash|git push/);
  });
});

describe('a temporary replay tree owns its node_modules (2026-11-26)', () => {
  it('never links an installed node_modules into a throwaway tree', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve: res } = await import('node:path');
    const root = res(__dirname, '..', '..');
    const tool = readFileSync(
      res(root, 'scripts/ops/horse-decision-crossbuild-replay.mjs'),
      'utf8'
    );
    const flagOff = readFileSync(res(root, 'scripts/ops/horse-flag-off-check.sh'), 'utf8');
    expect(tool).not.toMatch(/symlinkSync|ln -s/);
    expect(flagOff).not.toMatch(/^\s*ln -s/m);
    expect(tool).toContain("execFileSync('cp', ['-Rc', src, tmp]");
    expect(flagOff).toContain('cp -Rc "$NODE_MODULES" "$wt/server/node_modules"');
  });
});
