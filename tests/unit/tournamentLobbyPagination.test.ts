import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  readTournamentLobbyWindow,
  reconcileTournamentLobbyRead,
} from '../../src/utils/tournamentLobbyRead';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: id(i + 1),
    start_time: '2026-11-04T21:45:00Z',
    max_players: null,
  }));
function reader(source: ReturnType<typeof rows>) {
  const calls: (string | null)[] = [];
  return {
    calls,
    read: async (after: string | null) => {
      calls.push(after);
      return {
        data: source.filter((row) => after === null || row.id > after).slice(0, 500), // window-ok: Actual tournament data page, not a source-text window.
        error: null,
        count: source.filter((row) => after === null || row.id > after).length,
      };
    },
  };
}
describe('complete bounded lobby schedule', () => {
  it.each([501, 502, 1000])(
    'retains every %i-row schedule including unlimited equal-time tail events',
    async (total) => {
      const source = rows(total);
      const r = reader(source);
      const result = await readTournamentLobbyWindow(r.read);
      expect(result.error).toBeNull();
      expect(result.data).toEqual(source);
      expect(result.data?.at(-1)).toEqual(source.at(-1));
      expect(r.calls).toEqual(total === 1000 ? [null, id(500), id(1000)] : [null, id(500)]);
    }
  );
  it('reconciles a real birth behind the cursor and a deletion during the whole chain', async () => {
    const source = rows(502);
    const r = reader(source);
    const changes = new Map();
    const born = { ...source[0], id: id(0) };
    const result = await readTournamentLobbyWindow(async (after) => {
      if (after) {
        changes.set(born.id, { revision: 11, row: born, insertOnly: true });
        changes.set(id(2), { revision: 12, row: null });
      }
      return r.read(after);
    });
    expect(result.error).toBeNull();
    const reconciled = reconcileTournamentLobbyRead(result.data!, changes, 10);
    expect(reconciled).toHaveLength(502);
    expect(reconciled).toContainEqual(born);
    expect(reconciled.some((row) => row.id === id(2))).toBe(false);
  });
  it('refuses a failed later page rather than returning the first 500 as complete', async () => {
    const r = reader(rows(502));
    const failure = new Error('Second page unavailable');
    const result = await readTournamentLobbyWindow((after) =>
      after ? Promise.resolve({ data: null, error: failure }) : r.read(after)
    );
    expect(result).toEqual({ data: null, error: failure });
  });
  it('refuses a repeated/nonadvancing identity', async () => {
    const r = reader(rows(502));
    const result = await readTournamentLobbyWindow((after) =>
      after ? Promise.resolve({ data: [rows(1)[0]], error: null }) : r.read(after)
    );
    expect(result.data).toBeNull();
    expect(String(result.error)).toMatch(/Identities/);
  });
  it('bounds the read by the first exact total without demanding later count invariance', async () => {
    const r = reader(rows(502));
    const result = await readTournamentLobbyWindow(async (after) => ({
      ...(await r.read(after)),
      count: after ? 2 : 502,
    }));
    expect(result.data).toHaveLength(502);
    expect(result.error).toBeNull();
  });
  it('fails closed above 10000 rows and on exhausted initial page budget', async () => {
    const over = reader(rows(10001));
    expect((await readTournamentLobbyWindow(over.read)).data).toBeNull();
    expect(over.calls).toHaveLength(1);
    const growth = reader(rows(2000));
    const result = await readTournamentLobbyWindow(async (after) => ({
      ...(await growth.read(after)),
      count: 500,
    }));
    expect(result.data).toBeNull();
    expect(growth.calls).toHaveLength(2);
  });
});

it('executes the actual club-board query factory through all 502 scoped equal-time rows', async () => {
  const source = readFileSync('src/pages/ClubHomePage.tsx', 'utf8');
  const ast = ts.createSourceFile(
    'page.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'clubTournamentQuery')
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(initializer).toBeDefined();
  const sourceRows = rows(502);
  const calls: Record<string, unknown>[] = [];
  const supabase = {
    from: (table: string) => {
      const spec: Record<string, unknown> = { table };
      calls.push(spec);
      const query = {
        select: (_fields: string, options: unknown) => {
          spec.options = options;
          return query;
        },
        in: (field: string, value: unknown) => {
          spec[field] = value;
          return query;
        },
        lte: (field: string, value: unknown) => {
          spec[field] = value;
          return query;
        },
        order: (field: string, value: unknown) => {
          spec.order = [field, value];
          return query;
        },
        limit: (value: number) => {
          spec.limit = value;
          return query;
        },
        gt: (field: string, value: string) => {
          spec.cursor = [field, value];
          return query;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            resolve({
              data: sourceRows
                .filter((row) => !spec.cursor || row.id > (spec.cursor as string[])[1])
                .slice(0, Number(spec.limit)),
              error: null,
              count: sourceRows.filter(
                (row) => !spec.cursor || row.id > (spec.cursor as string[])[1]
              ).length,
            })
          ),
      };
      return query;
    },
  };
  const js = ts.transpileModule(`const factory=${initializer!.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const make = new Function(
    'supabase',
    'QUERY_LIMITS',
    'LOBBY_TOURNAMENT_STATUSES',
    'TOURNAMENT_ARENA_EMBED',
    'applyClubScope',
    'resolvedId',
    'unionId',
    'unionClubIds',
    'tournamentHorizon',
    `${js};return factory;`
  )(
    supabase,
    { MODERATE: 500 },
    ['REGISTERING'],
    'arena_embed',
    (_query: unknown, scope: unknown) => {
      calls.at(-1)!.scope = scope;
    },
    'club',
    'union',
    ['sibling'],
    '2026-11-08T00:00:00Z'
  );
  const result = await readTournamentLobbyWindow(make);
  expect(result.data).toEqual(sourceRows);
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.table === 'tournaments' && call.limit === 500)).toBe(true);
  expect(calls.map((call) => call.order)).toEqual([
    ['id', { ascending: true }],
    ['id', { ascending: true }],
  ]);
  expect(calls.map((call) => call.scope)).toEqual(
    Array(2).fill({ clubId: 'club', unionId: 'union', siblingClubIds: ['sibling'] })
  );
  expect(calls.map((call) => call.start_time)).toEqual(Array(2).fill('2026-11-08T00:00:00Z'));
  expect(calls[1].cursor).toEqual(['id', id(500)]);
});

it('refuses an API-truncated short page instead of certifying a missing schedule tail', async () => {
  const result = await readTournamentLobbyWindow(async () => ({
    data: rows(100),
    count: 502,
    error: null,
  }));
  expect(result.data).toBeNull();
  expect(String(result.error)).toMatch(/Incomplete/);
});
