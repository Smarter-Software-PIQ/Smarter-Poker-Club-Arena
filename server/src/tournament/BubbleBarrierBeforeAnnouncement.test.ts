import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { parsePayoutStructure } from './payoutStructure.js';
// Execute the maintained stage verbatim, with substituted I/O and neighboring boundaries.
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
function fixture(active: boolean, count: number, onBreak = false) {
  let release!: () => void;
  const pending = new Promise<boolean>((resolve) => {
    release = () => resolve(true);
  });
  const query: any = {
    select: () => query,
    eq: () => query,
    then: (resolve: any) => Promise.resolve({ count, error: null }).then(resolve),
  };
  const stage = stageFactory(
    {
      from: () => query,
      rpc: async () => ({
        data: { ok: true, is_satellite: true, ready: true, award_depth: 0 },
        error: null,
      }),
    },
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
      payout_structure: [
        { place: 1, percentage: 60 },
        { place: 2, percentage: 40 },
      ],
    },
    handForHandActive: active,
    handForHandAnnounced: active,
    prizePoolFinalized: true,
    noteEliminationSweepStep: vi.fn(),
    broadcast: vi.fn(() => pending),
    isOnBreak: () => onBreak,
    startHandForHandSync: vi.fn(),
    stopHandForHandSync: vi.fn(),
    requestUrgentEliminationSweepAfter: vi.fn(),
    successorDrainRequested: false,
    mysteryActivationBoundaryPending: false,
  };
  return { manager, tables, release, run: () => stage.call(manager) };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
describe('gameplay barriers do not wait for announcement delivery', () => {
  it('parks the bubble and arms synchronization before the broadcast answers', async () => {
    const f = fixture(false, 3);
    const run = f.run();
    await flush();
    const paused = f.tables.map((t) => t.pauseAfterHand.mock.calls.length),
      armed = f.manager.startHandForHandSync.mock.calls.length;
    f.release();
    await run;
    expect(paused).toEqual([1, 1]);
    expect(armed).toBe(1);
  });
  it('releases the burst bubble before the broadcast answers', async () => {
    const f = fixture(true, 2);
    const run = f.run();
    await flush();
    const resumed = f.tables.map((t) => t.resumeDealing.mock.calls.length);
    f.release();
    await run;
    expect(resumed).toEqual([1, 1]);
  });
  it('preserves the independent tournament break during a burst', async () => {
    const f = fixture(true, 2, true);
    const run = f.run();
    await flush();
    f.release();
    await run;
    expect(f.tables.every((t) => t.resumeDealing.mock.calls.length === 0)).toBe(true);
  });
  it.each(['successorDrainRequested', 'mysteryActivationBoundaryPending'] as const)(
    'preserves %s custody during a burst',
    async (owner) => {
      const f = fixture(true, 2);
      f.manager[owner] = true;
      const run = f.run();
      await flush();
      f.release();
      await run;
      expect(f.tables.every((t) => t.resumeDealing.mock.calls.length === 0)).toBe(true);
    }
  );
  it('releases a finalized zero-award satellite before waiting for its announcement', async () => {
    const f = fixture(true, 2);
    f.manager.tournamentCache.variant = 'satellite';
    const run = f.run();
    await flush();
    const resumed = f.tables.map((t) => t.resumeDealing.mock.calls.length);
    f.release();
    await run;
    expect(resumed).toEqual([1, 1]);
    expect(f.manager.broadcast).toHaveBeenCalledWith('bubble_burst', {
      playersRemaining: 2,
      paidPositions: 0,
      reason: 'satellite_has_no_awards',
    });
  });
});
