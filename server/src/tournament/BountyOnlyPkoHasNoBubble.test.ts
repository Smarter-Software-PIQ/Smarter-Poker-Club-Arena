import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { parsePayoutStructure } from './payoutStructure.js';
// Execute the maintained hand-for-hand stage verbatim with substituted I/O.
const source = readFileSync(new URL('./TournamentManagerEliminations.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('manager.ts', source, ts.ScriptTarget.Latest, true);
let stageNode: ts.LabeledStatement | undefined;
function visit(node: ts.Node): void {
  if (ts.isLabeledStatement(node) && node.label.text === 'handForHandStage') stageNode = node;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!stageNode) throw new Error('hand-for-hand stage not found');
const compiled = ts.transpileModule(`async function stage() {${stageNode.getText(ast)}}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const stageFactory = new Function(
  'supabase',
  'parsePayoutStructure',
  'deepestCanonicalPaidPlace',
  'sweepStopped',
  'completedStage',
  'reportError',
  'TournamentManagerBase',
  `${compiled};return stage;`
);
const ladder = Array.from({ length: 36 }, (_, i) => ({ place: i + 1, percentage: 1 }));
function fixture(active: boolean, count: number, row: Record<string, unknown>) {
  const query: any = {
    select: () => query,
    eq: () => query,
    then: (resolve: any) => Promise.resolve({ count, error: null }).then(resolve),
  };
  const stage = stageFactory(
    { from: () => query, rpc: async () => ({ data: null, error: null }) },
    parsePayoutStructure,
    (payouts: any[]) => Math.max(0, ...payouts.map((p) => p.place)),
    () => false,
    () => false,
    vi.fn(),
    { UNRESOLVED_BUST_RETRY_MS: 5000 }
  );
  const tables = [0, 1].map(() => ({ pauseAfterHand: vi.fn(), resumeDealing: vi.fn() }));
  const manager = {
    eliminationSweepCursor: { nextStage: 7 },
    tableEngines: new Map(tables.map((table, i) => [String(i), table])),
    tournamentId: 'event',
    tournamentCache: {
      tournament_type: 'MTT',
      variant: 'freezeout',
      payout_structure: ladder,
      ...row,
    },
    handForHandActive: active,
    handForHandAnnounced: active,
    prizePoolFinalized: true,
    noteEliminationSweepStep: vi.fn(),
    broadcast: vi.fn(async () => true),
    isOnBreak: () => false,
    startHandForHandSync: vi.fn(),
    stopHandForHandSync: vi.fn(),
    requestUrgentEliminationSweepAfter: vi.fn(),
    successorDrainRequested: false,
    mysteryActivationBoundaryPending: false,
  };
  return { manager, tables, run: () => stage.call(manager) };
}
const freeRoll = {
  is_pko: true,
  buy_in_amount: '0.00',
  guaranteed_prize: '0.00',
  prize_pool: '0.00',
};
describe('a bounty-only PKO has no money bubble', () => {
  it('never starts hand-for-hand one off its lifecycle ladder', async () => {
    const f = fixture(false, 37, freeRoll);
    await f.run();
    expect(f.manager.handForHandActive).toBe(false);
    expect(f.manager.startHandForHandSync).not.toHaveBeenCalled();
    expect(f.tables.every((t) => t.pauseAfterHand.mock.calls.length === 0)).toBe(true);
    expect(f.manager.broadcast).not.toHaveBeenCalledWith('hand_for_hand', expect.anything());
  });
  it('releases a hand-for-hand latch an earlier manager left behind', async () => {
    const f = fixture(true, 40, freeRoll);
    await f.run();
    expect(f.manager.handForHandActive).toBe(false);
    expect(f.manager.stopHandForHandSync).toHaveBeenCalledTimes(1);
    expect(f.tables.map((t) => t.resumeDealing.mock.calls.length)).toEqual([1, 1]);
    expect(f.manager.broadcast).toHaveBeenCalledWith('bubble_burst', {
      playersRemaining: 40,
      paidPositions: 0,
      reason: 'bounty_only_pko_pays_no_places',
    });
  });
  it.each([
    ['a funded place pool', { prize_pool: '120.00' }],
    ['a guarantee', { guaranteed_prize: '500.00' }],
    ['a paid entry', { buy_in_amount: '10.00' }],
    ['a non-PKO free roll', { is_pko: false }],
    ['a mystery bounty free roll', { is_mystery_bounty: true }],
  ])('keeps the money bubble for %s', async (_label, change) => {
    const f = fixture(false, 37, { ...freeRoll, ...change });
    await f.run();
    expect(f.manager.handForHandActive).toBe(true);
    expect(f.manager.startHandForHandSync).toHaveBeenCalledTimes(1);
    expect(f.tables.map((t) => t.pauseAfterHand.mock.calls.length)).toEqual([1, 1]);
  });
});
