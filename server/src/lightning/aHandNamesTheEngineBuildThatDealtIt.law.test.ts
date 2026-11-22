/**
 * LAW (2026-11-21): EVERY HAND NAMES THE ENGINE BUILD THAT DEALT IT.
 *
 * hand_history.engine_build (migration 20261118073245) is the only exact proof
 * of which release played a hand; cutovers swap the build several times a day,
 * so a Horse grade split by build needs it on every row. It was stamped only by
 * logHandHistory (cash and tournament tables). A Lightning hand's row is built
 * by LightningHandHost.handRow and settled by fn_lightning_settle_hand, never
 * through logHandHistory, so production 2026-11-20 19:12 UTC -> 2026-11-21
 * 14:50 UTC stored 25,725 Lightning hands with engine_build NULL against 0
 * unstamped physical cash or tournament hands (read-only count, 2026-11-21).
 *
 *   1. THE DOORS. Every engine source that sends a hand row to the database
 *      names one of the hand-commit functions below. The set of such files is
 *      pinned, and each door's row builder must spread handRowEngineBuild():
 *      a new hand-writing path fails here until its builder stamps the build.
 *   2. LIGHTNING. A played Lightning hand's settle row carries the exact
 *      lowercase 40-hex build; every settle retry carries the same one; the
 *      production backend sends it to fn_lightning_settle_hand unchanged
 *      (that function passes unknown keys to fn_ca_commit_hand_settlement ->
 *      fn_ca_insert_hand_with_awards, which keeps real hand_history columns).
 *   3. NO AUTHORITY, NO KEY. A short SHA or a bare ENGINE_VERSION is not a
 *      build: the key is omitted and the column stays NULL, as on a table.
 *
 * Cash and tournament rows: handHistory.test.ts ("names the serving engine
 * build ..." and "a tournament hand names the serving engine build too").
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), lane: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the engine-build law fixture');
    }),
    rpc: mocks.rpc,
  },
  maintenanceSupabase: {},
  DB_TIMEOUT_MS: 15_000,
}));
vi.mock('../services/lightningLaneSession.js', async () => {
  const real = await vi.importActual<typeof import('../services/lightningLaneSession.js')>(
    '../services/lightningLaneSession.js'
  );
  return { ...real, lightningLaneCall: mocks.lane };
});
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));
vi.mock('../services/HorseDailyRollupContract.js', () => ({
  horseDailyRollupContract: vi.fn(async () => true),
}));
const { mulberry32 } = await import('../engine/HandFuzzer.js');
const kit = await import('../testing/lightningHostTestKit.js');
const { createSupabaseLightningHandBackend } = await import('./LightningHandBackend.js');

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'c0ffee12'.repeat(5);

/** Every database function that inserts or commits a hand_history row. */
const HAND_COMMIT_FUNCTIONS = [
  'fn_ca_commit_hand_settlement',
  'fn_ca_commit_hand_settlement_before_lease_generation',
  'fn_ca_commit_hand_submission',
  'fn_ca_retain_hand_submission',
  'fn_ca_resume_hand_submission',
  'fn_ca_insert_hand_with_awards',
  'fn_ca_settle_hand_stacks_absolute',
  'fn_lightning_settle_hand',
];
/** Door (the file that calls the function) -> the file that builds its hand row. */
const DOORS: Record<string, string> = {
  'services/supabase/handHistory.ts': 'services/supabase/handHistory.ts', // cash + tournament
  'lightning/LightningHandBackend.ts': 'lightning/LightningHandHost.ts', // Lightning
};

function engineSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== 'testing') engineSources(p, out);
    } else if (/\.(ts|mts|mjs)$/.test(name) && !/\.(test|law|runtime)\./.test(name)) out.push(p);
  }
  return out;
}

async function playLightningHand(base: number, settleScript?: Array<'ok' | 'transport'>) {
  const formed = kit.formedHand(4, base);
  const t = kit.buildHost(formed, [100, 100, 100, 100], {
    horses: new Set([formed.players[0]!, formed.players[2]!]),
    ...(settleScript ? { settleScript } : {}),
  });
  await t.host.start();
  await kit.playOut(t.host, mulberry32(base));
  await kit.flush(40);
  return t;
}

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.rpc.mockReset();
  mocks.lane.mockReset();
});

describe('LAW: every hand names the engine build that dealt it', () => {
  it('1. every hand-writing door is known, and its row builder stamps the build', () => {
    const callers = new Set<string>();
    // A call names the function as a quoted string; prose cites it in backticks.
    const doorName = new RegExp(`['"](${HAND_COMMIT_FUNCTIONS.join('|')})['"]`);
    const directInsert = /from\(\s*['"]hand_history['"]\s*\)\s*\.\s*(insert|upsert)\b/;
    for (const file of engineSources(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (doorName.test(text) || directInsert.test(text)) callers.add(relative(SRC, file));
    }
    // A new path that writes a hand must be added here WITH a builder that stamps.
    expect([...callers].sort()).toEqual(Object.keys(DOORS).sort());
    for (const builder of new Set(Object.values(DOORS))) {
      const text = readFileSync(join(SRC, builder), 'utf8');
      expect(text, `${builder} must spread handRowEngineBuild() into its hand row`).toMatch(
        /\.\.\.handRowEngineBuild\(\)/
      );
    }
  });

  it('2. a Lightning hand row carries the exact build, and the backend sends it unchanged', async () => {
    vi.stubEnv('GIT_COMMIT_SHA', SHA.toUpperCase());
    const t = await playLightningHand(13_100);
    expect(t.calls.settle).toHaveLength(1);
    const row = t.calls.settle[0]!.handRow;
    expect(row.engine_build).toBe(SHA);

    mocks.lane.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({
      data: { ok: true, hand_history_id: t.calls.settle[0]!.handId },
      error: null,
    });
    const out = await createSupabaseLightningHandBackend().settle(t.calls.settle[0]!);
    expect(out.ok).toBe(true);
    const [fn, args] = mocks.rpc.mock.calls.at(-1)!;
    expect(fn).toBe('fn_lightning_settle_hand');
    expect((args as { p_hand_row: Record<string, unknown> }).p_hand_row.engine_build).toBe(SHA);
  });

  it('2b. every settle retry of one hand names the same build', async () => {
    vi.stubEnv('GIT_COMMIT_SHA', SHA);
    const t = await playLightningHand(13_200, ['transport', 'transport', 'ok']);
    expect(t.calls.settle).toHaveLength(3);
    expect(new Set(t.calls.settle.map((s) => s.handRow.engine_build))).toEqual(new Set([SHA]));
  });

  it.each([
    ['a short SHA', { GIT_COMMIT_SHA: SHA.slice(0, 8) }],
    ['a bare ENGINE_VERSION', { GIT_COMMIT_SHA: '', ENGINE_VERSION: 'local' }],
  ])('3. %s is no build: the Lightning row omits the key', async (_name, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const t = await playLightningHand(13_300);
    expect(t.calls.settle).toHaveLength(1);
    expect('engine_build' in t.calls.settle[0]!.handRow).toBe(false);
  });
});
