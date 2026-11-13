// The live V31 store serves a cell only when its dataset's round registration
// declares a valid range provenance for exactly that cell (FLOP-2 W2,
// 2026-11-12). Fail closed: no column, no registration, a failed read,
// malformed JSON, `forced`, missing game assumptions or a mapping for another
// key refuses the cell. The check is at load time; the decision path is
// structurally free of database reads.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), registration: vi.fn() }));
vi.mock('./supabase/client.js', () => ({
  supabase: {
    rpc: transport.rpc,
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: () => transport.registration(table, columns, column, value),
        }),
      }),
    }),
  },
}));
vi.mock('./errorReporter.js', () => ({ reportError: transport.report }));
import {
  _resetGtoV31ServingBinding,
  loadGtoPostflopV31,
  loadGtoPostflopV31Once,
  requireGtoV31ServingBinding,
  startGtoPostflopV31Loader,
  stopGtoPostflopV31Loader,
} from './GtoPostflopV31Loader.js';
import {
  _clearGtoPostflopV31,
  gtoPostflopV31Count,
  gtoPostflopV31RangeRefusals,
  gtoV31RangeProvenanceRefusal,
  replaceGtoPostflopV31Async,
} from '../engine/GtoPostflopV31.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { CELL, pagedCells, rangeProvenanceFor } from './V31LoaderFixture.js';

const KEY = [
  CELL.street,
  CELL.game_family,
  CELL.objective,
  CELL.utility_context,
  CELL.table_size,
  CELL.pot_type,
  CELL.hero_position,
  CELL.opponent_position,
  CELL.depth_bucket,
  CELL.texture_class,
  CELL.node_role,
  CELL.facing_kind,
  CELL.facing_size_bucket,
].join('|');
const valid = () => rangeProvenanceFor([CELL]);
const entry = () => valid()[0] as Record<string, any>;
const registered = (cell_provenance: unknown, dataset_id: unknown = CELL.dataset_id) => ({
  data: { dataset_id, cell_provenance },
  error: null,
});
const refusalLogs = () =>
  vi
    .mocked(console.warn)
    .mock.calls.filter(([line]) => String(line).includes('V31_RANGE_PROVENANCE_REFUSED'));
const fires = () =>
  Object.fromEntries(drainFires().map(({ feature, fires: n }) => [feature, n]))[
    'v31_certified_skip_no_range_provenance'
  ] ?? 0;

beforeEach(() => {
  transport.rpc.mockReset();
  transport.report.mockReset();
  transport.registration.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  _clearGtoPostflopV31();
  enableBrainTelemetry();
  drainFires();
});
afterEach(() => {
  stopGtoPostflopV31Loader();
  _resetGtoV31ServingBinding();
  _clearGtoPostflopV31();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadWith(registration: unknown, rows: unknown[] = [structuredClone(CELL)]) {
  transport.rpc.mockResolvedValueOnce({ data: rows, error: null });
  // A full 500-row page is not EOF: the loader reads one more (empty) page.
  if (rows.length === 500) transport.rpc.mockResolvedValueOnce({ data: [], error: null });
  if (registration instanceof Error) transport.registration.mockRejectedValueOnce(registration);
  else transport.registration.mockResolvedValueOnce(registration);
  return loadGtoPostflopV31Once();
}

describe('V31 live store refuses cells without valid range provenance', () => {
  it('serves a cell whose registration declares valid provenance, read once at load by dataset key', async () => {
    await expect(loadWith(registered(valid()))).resolves.toEqual({ ok: true, count: 1 });
    expect(gtoPostflopV31Count()).toBe(1);
    expect(gtoPostflopV31RangeRefusals()).toEqual({});
    expect(fires()).toBe(0);
    expect(transport.registration).toHaveBeenCalledTimes(1);
    expect(transport.registration).toHaveBeenCalledWith(
      'gto_v31_round_registrations',
      'dataset_id, cell_provenance',
      'dataset_key',
      CELL.dataset_key
    );
  });
  for (const construction of ['root', 'subgame'] as const) {
    it(`serves a ${construction} construction`, () => {
      const e = { ...entry(), range_construction: construction };
      expect(gtoV31RangeProvenanceRefusal([e], KEY, CELL.manifest_checksum)).toBeNull();
    });
  }

  it('the provenance column not installed (today) refuses every cell, logged once and counted', async () => {
    const absent = {
      data: null,
      error: {
        code: '42703',
        message: 'column gto_v31_round_registrations.cell_provenance does not exist',
      },
    };
    await expect(loadWith(absent)).resolves.toEqual({ ok: true, count: 0 });
    expect(gtoPostflopV31Count()).toBe(0);
    expect(gtoPostflopV31RangeRefusals()).toEqual({ no_provenance: 1 });
    expect(fires()).toBe(1);
    await expect(loadWith(absent)).resolves.toEqual({ ok: true, count: 0 });
    expect(refusalLogs()).toHaveLength(1);
    expect(transport.report).toHaveBeenCalledTimes(1);
    expect(transport.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'v31_range_provenance_refused' }),
      'GtoPostflopV31Loader.provenance'
    );
  });
  it.each(['42P01', 'PGRST204', 'PGRST205'])(
    'a not-installed schema (%s) is definitive: every cell refused, the load succeeds',
    async (code) => {
      const reply = { data: null, error: { code, message: 'not installed' } };
      await expect(loadWith(reply)).resolves.toEqual({ ok: true, count: 0 });
      expect(gtoPostflopV31RangeRefusals()).toEqual({ no_provenance: 1 });
    }
  );
  it.each([
    ['no registration for the dataset', { data: null, error: null }],
    ['a registration with null provenance', registered(null)],
    [
      'a registration linked to another dataset',
      registered(valid(), '22222222-2222-4222-8222-222222222222'),
    ],
    ['a registration not yet linked to any dataset', registered(valid(), null)],
    ['malformed JSON (a string)', registered('[{"cell":')],
    ['malformed JSON (an object)', registered({ cell: CELL })],
  ])('%s refuses the cell', async (_label, registration) => {
    await expect(loadWith(registration)).resolves.toEqual({ ok: true, count: 0 });
    expect(gtoPostflopV31Count()).toBe(0);
    expect(gtoPostflopV31RangeRefusals()).toEqual({ no_provenance: 1 });
  });

  const mutate = (change: (e: Record<string, any>) => void) => {
    const e = entry();
    change(e);
    return [e];
  };
  it.each([
    ['no entry for the cell', [], 'missing_cell'],
    [
      'an entry for another cell only',
      mutate((e) => (e.cell.texture_class = 'Amuc')),
      'missing_cell',
    ],
    ['two entries for the cell', [...valid(), ...valid()], 'missing_cell'],
    ['a malformed entry', [null, 'x', 7], 'missing_cell'],
    ['forced construction', mutate((e) => (e.range_construction = 'forced')), 'forced'],
    [
      'an unknown construction',
      mutate((e) => (e.range_construction = 'conditional')),
      'construction',
    ],
    ['no construction', mutate((e) => delete e.range_construction), 'construction'],
    ['no game assumptions', mutate((e) => delete e.game), 'game'],
    ['no rake', mutate((e) => delete e.game.rake), 'game'],
    ['a rake fraction above 1', mutate((e) => (e.game.rake = [1.5, 300])), 'game'],
    ['no stack', mutate((e) => delete e.game.effective_stack_chips), 'game'],
    ['a stack that is not the depth', mutate((e) => (e.game.effective_stack_chips = 4000)), 'game'],
    ['no root pot', mutate((e) => delete e.game.root_pot_chips), 'game'],
    ['another variant', mutate((e) => (e.game.variant = 'plo4')), 'game'],
    ['another pot type', mutate((e) => (e.game.pot_type = 'srp')), 'game'],
    ['no betting tree', mutate((e) => delete e.game.betting_tree_checksum), 'game'],
    [
      'another betting tree',
      mutate((e) => (e.game.betting_tree_checksum = '9'.repeat(64))),
      'game',
    ],
    ['no runtime mapping', mutate((e) => delete e.runtime_mapping), 'mapping'],
    [
      'a mapping for another node role',
      mutate((e) => (e.runtime_mapping.node_role = 'cbet')),
      'mapping',
    ],
    [
      'a mapping for another depth',
      mutate((e) => (e.runtime_mapping.depth_bucket = 40)),
      'mapping',
    ],
    ['a mapping missing a key field', mutate((e) => delete e.runtime_mapping.street), 'mapping'],
    [
      'swapped solver seats',
      mutate((e) => (e.runtime_mapping.solver_positions = ['BB', 'SB'])),
      'mapping',
    ],
    [
      'no acting solver seat',
      mutate((e) => delete e.runtime_mapping.hero_solver_player),
      'mapping',
    ],
  ])('%s refuses the cell', async (_label, provenance, reason) => {
    expect(gtoV31RangeProvenanceRefusal(provenance, KEY, CELL.manifest_checksum)).toBe(reason);
    await expect(loadWith(registered(provenance))).resolves.toEqual({ ok: true, count: 0 });
    expect(gtoPostflopV31RangeRefusals()).toEqual({ [reason]: 1 });
    expect(fires()).toBe(1);
  });

  it('refuses only the undeclared cells of a dataset and serves the rest', async () => {
    const rows = pagedCells(500);
    const provenance = rangeProvenanceFor(rows);
    provenance[0].range_construction = 'forced';
    provenance.splice(1, 1);
    await expect(loadWith(registered(provenance), rows)).resolves.toEqual({ ok: true, count: 498 });
    expect(gtoPostflopV31RangeRefusals()).toEqual({ forced: 1, missing_cell: 1 });
    expect(fires()).toBe(2);
  });

  it.each([
    ['a thrown transport error', new Error('connection reset')],
    [
      'a statement timeout',
      { data: null, error: { code: '57014', message: 'canceling statement' } },
    ],
    ['a gateway error without a code', { data: null, error: { message: 'Bad Gateway' } }],
  ])(
    'a transient read failure (%s) on a first load serves nothing and fails the attempt',
    async (_l, reply) => {
      await expect(loadWith(reply)).resolves.toEqual({ ok: false, count: 0 });
      expect(gtoPostflopV31Count()).toBe(0);
      expect(transport.report).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/^v31_range_provenance_unreadable/),
        }),
        'GtoPostflopV31Loader.load'
      );
    }
  );
  it('a transient read failure on a later load keeps the admitted snapshot served', async () => {
    await expect(loadWith(registered(valid()))).resolves.toEqual({ ok: true, count: 1 });
    await expect(loadWith(new Error('connection reset'))).resolves.toEqual({ ok: false, count: 0 });
    expect(gtoPostflopV31Count()).toBe(1);
    expect(gtoPostflopV31RangeRefusals()).toEqual({});
  });
  it('a transient read failure is retried on the short backoff, not after the 6 hour refresh', async () => {
    vi.useFakeTimers();
    transport.rpc.mockResolvedValue({ data: [structuredClone(CELL)], error: null });
    transport.registration
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue(registered(valid()));
    startGtoPostflopV31Loader();
    await expect(loadGtoPostflopV31()).resolves.toBe(0);
    expect(gtoPostflopV31Count()).toBe(0);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(transport.registration.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(gtoPostflopV31Count()).toBe(1);
  });
  it('the refusal log re-arms after a clean load and when the refusal counts change', async () => {
    const forced = valid();
    forced[0].range_construction = 'forced';
    await loadWith(registered(forced));
    await loadWith(registered(forced));
    expect(refusalLogs()).toHaveLength(1);
    await loadWith(registered(valid()));
    await loadWith(registered(forced));
    expect(refusalLogs()).toHaveLength(2);
    await loadWith(registered([]));
    expect(refusalLogs()).toHaveLength(3);
  });
  it('the provenance is read before the serving binding is re-checked', async () => {
    requireGtoV31ServingBinding('b'.repeat(40));
    const admission = {
      data: {
        active: { dataset_id: CELL.dataset_id, dataset_checksum: CELL.dataset_checksum },
        admitted: true,
      },
      error: null,
    };
    transport.rpc
      .mockResolvedValueOnce(admission)
      .mockResolvedValueOnce({ data: [structuredClone(CELL)], error: null })
      .mockResolvedValueOnce(admission);
    transport.registration.mockResolvedValueOnce(registered(valid()));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 1 });
    const [readAt] = transport.registration.mock.invocationCallOrder;
    const recheckAt = transport.rpc.mock.invocationCallOrder[2];
    expect(readAt).toBeLessThan(recheckAt);
  });
  it('kill-proof default: the live install with no provenance argument serves nothing', async () => {
    await expect(replaceGtoPostflopV31Async([structuredClone(CELL)])).resolves.toBe(0);
    expect(gtoPostflopV31Count()).toBe(0);
    await expect(
      replaceGtoPostflopV31Async([structuredClone(CELL)], undefined, valid())
    ).resolves.toBe(1);
  });
});

describe('the decision path makes no database call', () => {
  const root = join(__dirname, '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  it('the playbook policy and the store import no database client and query nothing', () => {
    for (const path of ['engine/HorseV31CertifiedPolicy.ts', 'engine/GtoPostflopV31.ts']) {
      const source = read(path);
      expect(source, path).not.toMatch(/supabase|\.rpc\(|\.from\(\s*['"]|fetch\(/);
    }
  });
  it('the lookup reads only the in-memory map; provenance is checked once, at install', () => {
    const source = read('engine/GtoPostflopV31.ts');
    const lookup = source.slice(
      source.indexOf('export function gtoStreetAdviceV31('),
      source.indexOf('export function gtoV31CellMatrix(')
    );
    expect(lookup.length).toBeGreaterThan(100);
    expect(lookup).not.toMatch(/Provenance|provenance|await|async/);
    expect(source.match(/admitByRangeProvenance\(/g)).toHaveLength(2);
  });
  it('no production file installs the live store through the ungated test seams', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          /\.ts$/.test(name) &&
          !/\.test\.ts$/.test(name) &&
          !/(Fixture|__tests__)/.test(path) &&
          !path.endsWith(join('engine', 'GtoPostflopV31.ts')) &&
          /\b(replaceGtoPostflopV31|setGtoPostflopV31)\(/.test(readFileSync(path, 'utf8'))
        )
          offenders.push(path);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
