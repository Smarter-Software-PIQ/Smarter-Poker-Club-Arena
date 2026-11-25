import { bindTournamentDataAuthority, dataActorHeaders } from './supabase/dataActorContext.js';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
const src = readFileSync(
  new URL('../tournament/TournamentManagerBase.ts', import.meta.url),
  'utf8'
);
const a = src.indexOf('    const operation = (async () => {');
const b = src.indexOf('    })().catch(async (error) => {', a);
const body = src.slice(a + '    const operation = (async () => {'.length, b);
const js = ts.transpileModule(
  `async function run(lifecycle,tableId,engine,supabase,nodeCrypto,F06HandPermit,resumeRetainedHandSubmission,INSTANCE_ID,bindTournamentDataAuthority){${body}}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;
const run = new Function(js + '; return run;')();
const tableId = 'aaaaaaaa-0000-4000-8000-000000000003';
const tournamentId = 'aaaaaaaa-0000-4000-8000-000000000001';
const leaseGeneration = 'aaaaaaaa-0000-4000-8000-000000000002';
const state = {
  ok: true,
  table_id: tableId,
  lifecycle: '9007199254740993',
  can_reserve: true,
  blocked_reason: null,
  used_hand_number_max: '1000000',
  unresolved_permit: null,
  next_hand_number_candidate: '1000001',
};
function fixture(data: unknown) {
  let starts = 0;
  let installed: any;
  let allocator: any;
  let prefetch: any;
  let clearPrefetch: any;
  let stateCalls = 0;
  let breakHolds = 0;
  const engine = {
    installF06Allocator: (_epoch: any, fn: any) => {
      allocator = fn;
    },
    installF06HandStatePrefetch: (fn: any, clear: any) => {
      prefetch = fn;
      clearPrefetch = clear;
    },
    installF06HandAdmission: (f: any) => (installed = f),
    installF06OwnReservedPermitReconciler: () => {},
    start: async () => {
      starts++;
    },
  };
  let valid = true;
  const self = {
    tournamentId,
    tournamentLeaseGeneration: leaseGeneration,
    lifecycleIsCurrent: () => valid,
    // The opening wave (tableOpenWaves.ts) is its own tested unit; here the
    // slot is granted at once so the admission body runs as before.
    awaitTableOpeningWave: async () => {},
    holdSourceForItsBreak: () => {
      breakHolds++;
    },
    tableEngines: new Map([[tableId, engine]]),
    gameServer: {
      ownsTournamentTableEngine: () => true,
      tournamentRetirementCustody: { admissionAllowed: () => true },
    },
  };
  const invoke = () =>
    run.call(
      self,
      {},
      tableId,
      engine,
      {
        rpc: async (name: string) => {
          if (name === 'fn_f06_hand_number_state') stateCalls++;
          if (
            name === 'fn_f06_allocate_hand_number' ||
            (name === 'fn_f06_hand_number_state' && starts > 0)
          ) {
            const headers = dataActorHeaders();
            expect(headers.get('x-smarter-tournament-id')).toBe(tournamentId);
            expect(headers.get('x-smarter-tournament-lease-generation')).toBe(leaseGeneration);
          }
          const result = typeof data === 'function' ? data(name) : data;
          if (result && typeof result === 'object' && '__rpcResponse' in result) {
            return { data: result.data, error: result.error };
          }
          return {
            data: result,
            error: null,
          };
        },
      },
      { randomUUID: () => 'uuid' },
      class {
        constructor(public binding: unknown) {}
      },
      async () => null,
      'original-fixture-instance',
      bindTournamentDataAuthority
    );
  return {
    invoke,
    starts: () => starts,
    installed: () => installed,
    allocator: () => allocator,
    prefetch: () => prefetch,
    clearPrefetch: () => clearPrefetch,
    stateCalls: () => stateCalls,
    breakHolds: () => breakHolds,
    fence: () => (valid = false),
  };
}
it('actual managed-start body installs provider only after complete resolved projection', async () => {
  const f = fixture(state);
  await f.invoke();
  expect(f.starts()).toBe(1);
  await expect(f.installed()('999999')).rejects.toThrow('below_durable_floor');
  expect((await f.installed()('1000001')).binding.lifecycle).toBe(state.lifecycle);
});
it('actual managed-start body refuses missing, unresolved and unsafe startup state', async () => {
  for (const patch of [
    { unresolved_permit: undefined },
    { unresolved_permit: { permit_id: 'old' } },
    { next_hand_number_candidate: '1000002' },
    { used_hand_number_max: '9007199254740993' },
  ]) {
    const f = fixture({ ...state, ...patch });
    await expect(f.invoke()).rejects.toThrow('projection_unproven');
    expect(f.starts()).toBe(0);
  }
});
it('actual allocator callback validates canonical safe decimal and exact table/lifecycle', async () => {
  for (const patch of [
    { hand_number: '01' },
    { hand_number: '9007199254740992' },
    { table_id: 'other' },
    { lifecycle: '2' },
    { hand_number_high_water: '1000001' },
  ]) {
    const f = fixture((name: string) =>
      name === 'fn_f06_allocate_hand_number'
        ? {
            ok: true,
            table_id: tableId,
            lifecycle: state.lifecycle,
            hand_number: '1000001',
            hand_number_high_water: '1000000',
            ...patch,
          }
        : state
    );
    await f.invoke();
    await expect(f.allocator()()).rejects.toThrow('unproven');
  }
  const f = fixture((name: string) =>
    name === 'fn_f06_allocate_hand_number'
      ? {
          ok: true,
          table_id: tableId,
          lifecycle: state.lifecycle,
          hand_number: '1000001',
          hand_number_high_water: '1000000',
        }
      : state
  );
  await f.invoke();
  expect(await f.allocator()()).toBe(1000001);
});

it('actual managed-start prefetch consumes a fresh healthy state once and falls back on clear, error, or break hold', async () => {
  let mode: 'ok' | 'error' | 'break' = 'ok';
  const f = fixture(() => {
    if (mode === 'error') {
      mode = 'ok';
      return { __rpcResponse: true, data: null, error: { message: 'transient_timeout' } };
    }
    if (mode === 'break') {
      return { ...state, can_reserve: false, blocked_reason: 'source_excluded' };
    }
    return state;
  });
  await f.invoke();
  const afterStart = f.stateCalls();

  // 1. Fresh prefetch satisfies admission with ZERO extra fn_f06_hand_number_state RPCs.
  await f.prefetch()();
  expect(f.stateCalls()).toBe(afterStart + 1);
  expect((await f.installed()('1000001')).binding.lifecycle).toBe(state.lifecycle);
  expect(f.stateCalls()).toBe(afterStart + 1);

  // 2. Single-use: a second admission without a new prefetch reads fresh.
  expect((await f.installed()('1000002')).binding.lifecycle).toBe(state.lifecycle);
  expect(f.stateCalls()).toBe(afterStart + 2);

  // 3. Clearing the prefetch forces a fresh read on admission.
  await f.prefetch()();
  f.clearPrefetch()();
  expect((await f.installed()('1000003')).binding.lifecycle).toBe(state.lifecycle);
  expect(f.stateCalls()).toBe(afterStart + 4);

  // 4. An errored prefetch falls back cleanly to a fresh read on admission.
  mode = 'error';
  await f.prefetch()();
  expect((await f.installed()('1000004')).binding.lifecycle).toBe(state.lifecycle);
  expect(f.stateCalls()).toBe(afterStart + 6);

  // 5. A prefetched source_excluded state is STILL honored as a break hold & refusal (never bypassed).
  mode = 'break';
  await f.prefetch()();
  await expect(f.installed()('1000005')).rejects.toThrow(/source_excluded/);
  expect(f.breakHolds()).toBe(1);
});
