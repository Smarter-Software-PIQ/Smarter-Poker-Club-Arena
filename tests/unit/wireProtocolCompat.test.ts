import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  EXIT_BREAKING,
  EXIT_OK,
  EXIT_UNREADABLE,
  buildContractFromSources,
  compareWireContracts,
  extractRpcNames,
  extractWsMessageTypes,
  runCheck,
  scanPostgresRpcDefinitions,
  scanWorkingTree,
} from '../../scripts/ci/check-wire-protocol-compat.mjs';
import { isReleaseControlPath } from '../../scripts/ci/release-control-paths.mjs';

const ROOT = resolve(__dirname, '..', '..');
const SCRIPT = resolve(ROOT, 'scripts', 'ci', 'check-wire-protocol-compat.mjs');

const BASE_FILES = [
  {
    path: 'server/src/transport/TableStateHub.ts',
    content: `
      export type HubMessage =
        | { type: 'SNAPSHOT'; tableId: string }
        | { type: 'DELTA'; tableId: string }
        | { type: 'EVENT'; tableId: string }
        | { type: 'USER_EVENT'; tableId: string };
    `,
  },
  {
    path: 'server/src/hub/ChannelHub.ts',
    content: `
      type Outbound = { type: 'CLUB_PRESENCE_UPDATE' } | { type: 'FINANCIAL_UPDATE' };
    `,
  },
  {
    path: 'server/src/services/WaitlistWorker.ts',
    content: `
      await supabase.rpc('fn_table_waitlist_join', { p_table_id: id });
      await supabase.rpc('fn_table_waitlist_leave', { p_table_id: id });
    `,
  },
  {
    path: 'src/services/EngineStateClient.ts',
    content: `
      function handle(msg: any) {
        switch (msg.type) {
          case 'SNAPSHOT': return 1;
          case 'DELTA': return 2;
          case 'EVENT': return 3;
          case 'USER_EVENT': return 4;
          case 'CLUB_PRESENCE_UPDATE': return 5;
          case 'FINANCIAL_UPDATE': return 6;
        }
      }
    `,
  },
  {
    path: 'src/services/WaitlistService.ts',
    content: `
      await supabase.rpc('fn_table_waitlist_join', { p_table_id: id });
      await supabase.rpc('fn_table_waitlist_leave', { p_table_id: id });
    `,
  },
];

describe('scripts/ci/check-wire-protocol-compat.mjs', () => {
  it('is strictly outside CONTROL_INPUTS (isReleaseControlPath === false)', () => {
    expect(isReleaseControlPath('scripts/ci/check-wire-protocol-compat.mjs')).toBe(false);
    expect(isReleaseControlPath('tests/unit/wireProtocolCompat.test.ts')).toBe(false);
  });

  it('extracts WS message types and RPC names while ignoring comments', () => {
    const ws = extractWsMessageTypes(`
      // type: 'COMMENTED_OUT_TYPE'
      /* case 'BLOCK_COMMENT_TYPE': */
      type Frame = { type: 'SNAPSHOT' } | { type: 'PING' };
      if (msg.type === 'RESYNC') {}
    `);
    expect(ws).toEqual(['PING', 'RESYNC', 'SNAPSHOT']);

    const rpcs = extractRpcNames(`
      // supabase.rpc('fn_commented_out')
      await supabase.rpc('fn_dispute_submit', {});
      await client.rpc("fn_resolve_dispute", {});
    `);
    expect(rpcs).toEqual(['fn_dispute_submit', 'fn_resolve_dispute']);
  });

  it('allows strictly additive WS message types and RPC names (exit 0)', () => {
    const base = buildContractFromSources(BASE_FILES);
    const head = buildContractFromSources([
      ...BASE_FILES,
      {
        path: 'server/src/transport/EngineWebSocketServer.ts',
        content: `export type Additive = { type: 'TOURNAMENT_CLOCK_SYNC' };`,
      },
      {
        path: 'src/services/EngineStateClient.ts',
        content: `
          ${BASE_FILES[3].content}
          const extra = { type: 'TOURNAMENT_CLOCK_SYNC' };
        `,
      },
      {
        path: 'server/src/services/NewFeature.ts',
        content: `await supabase.rpc('fn_new_additive_rpc', {});`,
      },
    ]);

    const verdict = compareWireContracts(base, head);
    expect(verdict.ok).toBe(true);
    expect(verdict.exitCode).toBe(EXIT_OK);
    expect(verdict.breakingChanges).toEqual([]);
    expect(verdict.added.serverWsTypes).toContain('TOURNAMENT_CLOCK_SYNC');
    expect(verdict.added.serverRpcNames).toContain('fn_new_additive_rpc');
  });

  it('flags breaking removal or rename of a shared WS frame type used by cached clients (exit 1)', () => {
    const base = buildContractFromSources(BASE_FILES);
    // Server renames SNAPSHOT -> TABLE_SNAPSHOT and removes USER_EVENT
    const headFiles = BASE_FILES.map((f) =>
      f.path === 'server/src/transport/TableStateHub.ts'
        ? {
            ...f,
            content: `
              export type HubMessage =
                | { type: 'TABLE_SNAPSHOT'; tableId: string }
                | { type: 'DELTA'; tableId: string }
                | { type: 'EVENT'; tableId: string };
            `,
          }
        : f
    );
    const head = buildContractFromSources(headFiles);

    const verdict = compareWireContracts(base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.exitCode).toBe(EXIT_BREAKING);
    const snapshotFinding = verdict.breakingChanges.find((b) => b.identifier === 'SNAPSHOT');
    expect(snapshotFinding).toBeDefined();
    expect(snapshotFinding?.suspectedRename).toBe('TABLE_SNAPSHOT');
    expect(verdict.breakingChanges.some((b) => b.identifier === 'USER_EVENT')).toBe(true);
  });

  it('flags breaking removal or rename of a shared RPC identifier (exit 1)', () => {
    const base = buildContractFromSources(BASE_FILES);
    const headFiles = BASE_FILES.map((f) =>
      f.path === 'server/src/services/WaitlistWorker.ts'
        ? {
            ...f,
            content: `
              await supabase.rpc('fn_table_waitlist_join_v2', { p_table_id: id });
              await supabase.rpc('fn_table_waitlist_leave', { p_table_id: id });
            `,
          }
        : f
    );
    const head = buildContractFromSources(headFiles);

    const verdict = compareWireContracts(base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.exitCode).toBe(EXIT_BREAKING);
    const rpcFinding = verdict.breakingChanges.find(
      (b) => b.kind === 'rpc_name' && b.identifier === 'fn_table_waitlist_join'
    );
    expect(rpcFinding).toBeDefined();
    expect(rpcFinding?.suspectedRename).toBe('fn_table_waitlist_join_v2');
  });

  it('treats removing a server outbound supabase.rpc() call as non-breaking advisory when the Postgres function remains defined in migrations', () => {
    const base = buildContractFromSources(BASE_FILES);
    const headFiles = BASE_FILES.map((f) =>
      f.path === 'server/src/services/WaitlistWorker.ts'
        ? {
            ...f,
            content: `
              await supabase.rpc('fn_table_waitlist_leave', { p_table_id: id });
            `,
          }
        : f
    );
    const head = buildContractFromSources(headFiles);

    // Still defined in supabase/migrations/ (and not dropped) -> non-breaking advisory.
    const activeRpcs = scanPostgresRpcDefinitions([
      {
        path: 'supabase/migrations/20260101000000_waitlist.sql',
        content: `
          CREATE OR REPLACE FUNCTION public.fn_table_waitlist_join(p_table_id uuid)
          RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;
        `,
      },
    ]);
    const advisoryVerdict = compareWireContracts(base, head, { activePostgresRpcs: activeRpcs });
    expect(advisoryVerdict.ok).toBe(true);
    expect(advisoryVerdict.exitCode).toBe(EXIT_OK);
    expect(advisoryVerdict.breakingChanges).toEqual([]);
    expect(advisoryVerdict.advisories).toHaveLength(1);
    expect(advisoryVerdict.advisories[0]).toMatchObject({
      kind: 'rpc_name',
      side: 'server',
      identifier: 'fn_table_waitlist_join',
    });

    // Missing from migrations -> breaking!
    const missingVerdict = compareWireContracts(base, head, { activePostgresRpcs: new Set() });
    expect(missingVerdict.ok).toBe(false);
    expect(missingVerdict.exitCode).toBe(EXIT_BREAKING);
    expect(missingVerdict.breakingChanges).toHaveLength(1);
    expect(missingVerdict.breakingChanges[0].identifier).toBe('fn_table_waitlist_join');

    // Defined earlier, then dropped in a later migration -> breaking!
    const droppedRpcs = scanPostgresRpcDefinitions([
      {
        path: 'supabase/migrations/20260101000000_waitlist.sql',
        content: `CREATE FUNCTION public.fn_table_waitlist_join(p_table_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;`,
      },
      {
        path: 'supabase/migrations/20261128000000_drop_waitlist.sql',
        content: `DROP FUNCTION IF EXISTS public.fn_table_waitlist_join(uuid);`,
      },
    ]);
    const droppedVerdict = compareWireContracts(base, head, { activePostgresRpcs: droppedRpcs });
    expect(droppedVerdict.ok).toBe(false);
    expect(droppedVerdict.exitCode).toBe(EXIT_BREAKING);

    // Dropped and re-created in chronological order -> still active -> non-breaking advisory!
    const recreatedRpcs = scanPostgresRpcDefinitions([
      {
        path: 'supabase/migrations/20260101000000_waitlist.sql',
        content: `CREATE FUNCTION public.fn_table_waitlist_join(p_table_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;`,
      },
      {
        path: 'supabase/migrations/20261128000000_recreate_waitlist.sql',
        content: `
          DROP FUNCTION IF EXISTS public.fn_table_waitlist_join(uuid);
          CREATE OR REPLACE FUNCTION public.fn_table_waitlist_join(p_table_id uuid, p_extra int DEFAULT 0)
          RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;
        `,
      },
    ]);
    const recreatedVerdict = compareWireContracts(base, head, {
      activePostgresRpcs: recreatedRpcs,
    });
    expect(recreatedVerdict.ok).toBe(true);
    expect(recreatedVerdict.exitCode).toBe(EXIT_OK);

    // Dropping an older overload while a newer overload stays active -> still non-breaking advisory!
    const overloadRpcs = scanPostgresRpcDefinitions([
      {
        path: 'supabase/migrations/20260101000000_v1.sql',
        content: `CREATE FUNCTION public.fn_table_waitlist_join(p_table_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;`,
      },
      {
        path: 'supabase/migrations/20260201000000_v2.sql',
        content: `CREATE OR REPLACE FUNCTION public.fn_table_waitlist_join(p_table_id uuid, p_token text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;`,
      },
      {
        path: 'supabase/migrations/20261128000000_drop_v1.sql',
        content: `DROP FUNCTION IF EXISTS public.fn_table_waitlist_join(uuid);`,
      },
    ]);
    const overloadVerdict = compareWireContracts(base, head, {
      activePostgresRpcs: overloadRpcs,
    });
    expect(overloadVerdict.ok).toBe(true);
    expect(overloadVerdict.exitCode).toBe(EXIT_OK);
  });

  it('passes cleanly on the live repository against origin/main and discovers real shared WS frames', () => {
    const live = scanWorkingTree(ROOT);
    expect(live.shared.wsTypes).toContain('SNAPSHOT');
    expect(live.shared.wsTypes).toContain('DELTA');
    expect(live.shared.wsTypes).toContain('EVENT');
    expect(live.shared.wsTypes).toContain('USER_EVENT');
    expect(live.shared.wsTypes).toContain('PING');
    expect(live.shared.wsTypes).toContain('PONG');
    expect(live.shared.wsTypes).toContain('FINANCIAL_UPDATE');

    const report = runCheck({ repoRoot: ROOT, baseRef: 'origin/main' });
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(EXIT_OK);
    expect(report.breakingChanges).toEqual([]);
  });

  it('fails closed (exit 3) when --base ref cannot be read', () => {
    const proc = spawnSync(
      'node',
      [SCRIPT, '--repo-root', ROOT, '--base', 'refs/heads/does-not-exist-xyz'],
      {
        encoding: 'utf8',
      }
    );
    expect(proc.status).toBe(EXIT_UNREADABLE);
    const parsed = JSON.parse(proc.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.exitCode).toBe(EXIT_UNREADABLE);
  });
});
