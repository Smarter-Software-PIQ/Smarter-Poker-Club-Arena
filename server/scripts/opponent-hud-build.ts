/**
 * OPPONENT HUD BUILD (2026-11-20, PLO-OWNER lane OPPONENT-HUD): backfill, reconciliation and dry run of the lifetime
 * public opponent profiles (server/src/engine/opponentHud/OpponentHudProfile.ts).
 *
 *   npx tsx server/scripts/opponent-hud-build.ts --from-db [--since ISO] [--until ISO] --dry-run --out FILE
 *   npx tsx server/scripts/opponent-hud-build.ts --from-db --apply                             (backfill, rebuild)
 *
 * --since defaults to the first PLO4/PLO5 hand hand_history holds (read from the database: the lifetime starts at
 * hand one, lead ruling 2026-11-21 18:38Z); --apply refuses a later --since. Cash and tournament hands both count.
 *   npx tsx server/scripts/opponent-hud-build.ts --from-jsonl FILE --dry-run --out FILE        (offline copy)
 *
 * Source: fn_opponent_hud_hands_page (public fields only; the dealt cards never leave the database) or a JSON-lines
 * copy of the same rows. Every hand goes through the same handRecordFromRow / applyHudHand the engine uses, oldest
 * first, so a backfilled profile is exactly what the live engine would have built hand by hand. The population row
 * ('*') holds fitHudPriors of the result. --apply writes with rebuild=true (a backfill replaces the stored row);
 * (The nightly verification runs in the engine: OpponentHudStore.reconcileDay, which compares each profile's day
 * list and day sum with hand_history, alerts on any difference and never writes a count.)
 * A stored row with more hands than the rebuild read is KEPT, always (OpponentHudBackfillPlan; no --force).
 * Operators only. Never prints a card (there is none in the input).
 */
import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  HUD_FAMILIES,
  HUD_STATS,
  applyHudHandToProfiles,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
  type OpponentHudProfile,
} from '../src/engine/opponentHud/OpponentHudProfile.js';
import {
  fitHudPriors,
  hudStakeBand,
  type HudPopulation,
} from '../src/engine/opponentHud/OpponentHud.js';
import { extractHandDeltas } from '../src/engine/opponentHud/OpponentHudProfile.js';
import {
  HUD_BACKFILL_DEFAULT_CONCURRENCY,
  HUD_BACKFILL_DEFAULT_WINDOW_HOURS,
  HUD_BACKFILL_MAX_CONCURRENCY,
  HUD_BACKFILL_PAGE_LIMIT,
  SharedBackfillPacer,
  pageAllOpponentHudHandsConcurrent,
  planOpponentHudBackfill,
  withTransientBackfillRetry,
} from '../src/engine/opponentHud/OpponentHudBackfillPlan.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const profiles = new Map<string, OpponentHudProfile>();
const refusals = new Map<string, number>();
const stakePools: Record<string, Record<string, Record<string, [number, number]>>> = {};
let hands = 0;
/** the newest hand applied: the sync point the engine catches up from when the option is switched on */
let lastHandAt = -1;
const t0 = Date.now();

function takeRecord(rec: HudHandRecord | string): void {
  if (typeof rec === 'string') {
    refusals.set(rec, (refusals.get(rec) ?? 0) + 1);
    return;
  }
  hands += 1;
  if (rec.at > lastHandAt) lastHandAt = rec.at;
  // pooled counts per family and stake band: the stake priors of a new opponent
  // a tournament big blind is chips, not a stake: no stake band
  const band = rec.tournament ? null : hudStakeBand(rec.bb);
  if (band) {
    const fam = (stakePools[rec.family] ??= {});
    const pool = (fam[band] ??= {});
    for (const d of extractHandDeltas(rec))
      for (const [stat, [o, h]] of d.stats) {
        const c = (pool[stat] ??= [0, 0]);
        c[0] += o;
        c[1] += h;
      }
  }
  applyHudHandToProfiles(rec, (user) => {
    const k = `${rec.family}|${user}`;
    let p = profiles.get(k);
    if (!p) {
      p = emptyHudProfile(user, rec.family);
      profiles.set(k, p);
    }
    return p;
  });
}

function take(row: unknown): void {
  takeRecord(handRecordFromRow(row));
}

async function fromJsonl(file: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) take(JSON.parse(line));
}

async function db() {
  return (await import('../src/services/supabase.js')).supabase;
}

/**
 * RATE LIMIT (2026-11-21): the backfill shares the production database with live play, so it pauses between pages
 * and between write batches (--pause-ms, default 200) and doubles the pause after any call slower than one second
 * (capped at 10 s, halving back after fast calls), the same rule as the engine's switch-on catch-up.
 * --slow-ms N (default 1000) sets what "slower" means. A 1,500-hand page is 4.0-5.3 MB and takes 0.8-1.6 s inside the
 * database alone (read-only measurement, OPPONENT-HUD-7, 8:25 AM Nov 21), so at the default every page counts as slow
 * and the pause sits at its 10 s cap (about 3 h of pauses over 1,102 pages) although nothing got slower. The engine's
 * catch-up reads pages of at most 250 rows and keeps the 1 s rule; the backfill run names its own threshold.
 */
const BASE_PAUSE_MS = Math.max(0, Number(opt('--pause-ms') ?? 200) || 0);
const SLOW_MS = Math.max(1000, Number(opt('--slow-ms') ?? 1000) || 1000);
const CONCURRENCY = Math.min(
  HUD_BACKFILL_MAX_CONCURRENCY,
  Math.max(1, Math.floor(Number(opt('--concurrency') ?? HUD_BACKFILL_DEFAULT_CONCURRENCY) || 1))
);
const WINDOW_HOURS = Math.min(
  168,
  Math.max(1, Number(opt('--window-hours') ?? HUD_BACKFILL_DEFAULT_WINDOW_HOURS) || 4)
);
let pauseMs = BASE_PAUSE_MS;
async function paced<T>(call: () => PromiseLike<T>): Promise<T> {
  const t0 = Date.now();
  const out = await call();
  pauseMs =
    Date.now() - t0 > SLOW_MS
      ? Math.min(10_000, Math.max(pauseMs, 100) * 2)
      : Math.max(BASE_PAUSE_MS, Math.floor(pauseMs / 2));
  if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  return out;
}

/** created_at of the first PLO4/PLO5/NLH hand (cash or tournament) hand_history holds, or null when none. */
async function firstRetainedHandMs(): Promise<number | null> {
  const client = await db();
  const data = await withTransientBackfillRetry(
    async () => {
      const { data: rows, error } = await client.rpc('fn_opponent_hud_hands_page', {
        p_after_at: '1970-01-01T00:00:00Z',
        p_after_id: '00000000-0000-0000-0000-000000000000',
        p_until: new Date().toISOString(),
        p_limit: 1,
      });
      if (error) throw new Error(`first hand read failed: ${error.message}`);
      return (rows ?? []) as { created_at: string }[];
    },
    {
      onRetry: ({ attempt, delayMs, message }) =>
        process.stderr.write(`first hand read retry #${attempt} (${delayMs}ms): ${message}\n`),
    }
  );
  const first = data[0];
  return first ? Date.parse(first.created_at) : null;
}

async function fromDb(since: string, until: string): Promise<void> {
  const client = await db();
  const pacer = new SharedBackfillPacer({
    maxConcurrency: CONCURRENCY,
    basePauseMs: BASE_PAUSE_MS,
    slowMs: SLOW_MS,
  });
  process.stderr.write(
    `fromDb start: concurrency=${CONCURRENCY} windowHours=${WINDOW_HOURS} limit=${HUD_BACKFILL_PAGE_LIMIT} slowMs=${SLOW_MS} basePauseMs=${BASE_PAUSE_MS}\n`
  );
  const res = await pageAllOpponentHudHandsConcurrent<
    { id: string; created_at: string },
    HudHandRecord | string
  >({
    since,
    until,
    concurrency: CONCURRENCY,
    windowMs: Math.round(WINDOW_HOURS * 3600 * 1000),
    limit: HUD_BACKFILL_PAGE_LIMIT,
    pacer,
    fetchPage: async ({ afterAt, afterId, until: u, limit }) => {
      const { data, error } = await client.rpc('fn_opponent_hud_hands_page', {
        p_after_at: afterAt,
        p_after_id: afterId,
        p_until: u,
        p_limit: limit,
      });
      if (error) throw new Error(`hands page failed: ${error.message}`);
      return (data ?? []) as { id: string; created_at: string }[];
    },
    mapRow: (r) => handRecordFromRow(r),
    onItem: (rec) => takeRecord(rec),
    onWindowComplete: ({
      windowIndex,
      totalWindows,
      rows,
      until: winUntil,
      effectiveConcurrency,
      pauseMs: curPause,
    }) => {
      if (rows > 0 || windowIndex === totalWindows - 1) {
        process.stderr.write(
          `window ${windowIndex + 1}/${totalWindows} hands ${hands} through ${winUntil} (c=${effectiveConcurrency} pause=${curPause}ms)\n`
        );
      }
    },
    onRetry: ({ windowIndex, attempt, prevLimit, nextLimit, delayMs, afterAt, message }) => {
      process.stderr.write(
        `hands page retry #${attempt} [w${windowIndex}] at ${afterAt} (limit ${prevLimit} -> ${nextLimit}, wait ${delayMs}ms): ${message}\n`
      );
    },
  });
  process.stderr.write(
    `fromDb complete: windows=${res.windows} pages=${res.pages} rows=${res.rows} retries=${res.retries} last=${res.afterAt}\n`
  );
}

function summary() {
  const sizes = [...profiles.values()].map((p) => JSON.stringify(p).length).sort((a, b) => a - b);
  const q = (f: number) => sizes[Math.min(sizes.length - 1, Math.floor(f * sizes.length))] ?? 0;
  const byFamily: Record<string, number> = {};
  for (const p of profiles.values()) byFamily[p.family] = (byFamily[p.family] ?? 0) + 1;
  const priors: Record<string, HudPopulation> = {};
  for (const fam of HUD_FAMILIES) {
    const stakes: HudPopulation['stakes'] = {};
    for (const [band, pool] of Object.entries(stakePools[fam] ?? {})) {
      stakes[band] = {};
      for (const [stat, [o, h]] of Object.entries(pool))
        if (o > 0) stakes[band][stat] = [Math.round((h / o) * 1000) / 1000, Math.round(o)];
    }
    priors[fam] = {
      family: fitHudPriors([...profiles.values()].filter((p) => p.family === fam)),
      stakes,
    };
  }
  return {
    hands,
    refusals: Object.fromEntries(refusals),
    profiles: profiles.size,
    byFamily,
    profileBytes: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: sizes[sizes.length - 1] ?? 0 },
    statsRegistered: HUD_STATS.length,
    ms: Date.now() - t0,
    priors,
  };
}

async function main(): Promise<void> {
  const jsonl = opt('--from-jsonl');
  if (jsonl) await fromJsonl(jsonl);
  let since = opt('--since');
  let firstRetainedMs: number | null = null;
  if (!jsonl && flag('--from-db')) {
    firstRetainedMs = await firstRetainedHandMs();
    since ??= new Date(firstRetainedMs ?? Date.now()).toISOString();
    console.log(
      `first retained PLO4/PLO5 hand ${firstRetainedMs === null ? 'none' : new Date(firstRetainedMs).toISOString()}; since ${since}`
    );
    if (flag('--apply')) {
      const pre = planOpponentHudBackfill({
        profiles: [],
        storedHands: new Map(),
        sinceMs: Date.parse(since),
        firstRetainedMs,
        forceRequested: flag('--force'),
      });
      if (!pre.ok) throw new Error(`refused: ${pre.refusal}`);
    }
    // the first hand itself is read: the keyset starts at (since, the zero id), and every hand id is above it
    await fromDb(since, opt('--until') ?? new Date().toISOString());
  } else if (!jsonl) throw new Error('--from-jsonl FILE or --from-db');
  const s = summary();
  const out = opt('--out');
  if (out) {
    writeFileSync(out, JSON.stringify({ summary: s, profiles: [...profiles.values()] }), {
      mode: 0o600,
    });
  }
  console.log(
    JSON.stringify({
      ...s,
      priors: undefined,
      priorsStats: Object.keys(s.priors.plo5?.family ?? {}).length,
      stakeBands: Object.keys(s.priors.plo5?.stakes ?? {}),
    })
  );
  if (flag('--apply')) {
    const client = await db();
    // A stored profile with MORE hands than this rebuild holds hands the rebuild did not read: it is KEPT, always
    // (OpponentHudBackfillPlan, decided on the actual retained rows; no override). Every other row is rebuilt.
    const storedHands = new Map<string, number>();
    for (const fam of HUD_FAMILIES) {
      const users = [...profiles.values()].filter((p) => p.family === fam).map((p) => p.user);
      for (let i = 0; i < users.length; i += 50) {
        const rowsRead = await withTransientBackfillRetry(
          async () => {
            const { data, error } = await client.rpc('fn_opponent_hud_profiles_read', {
              p_user_ids: users.slice(i, i + 50),
              p_family: fam,
            });
            if (error) throw new Error(`read failed: ${error.message}`);
            return (data ?? []) as { user_id: string; hands: number }[];
          },
          {
            onRetry: ({ attempt, delayMs, message }) =>
              process.stderr.write(
                `stored read retry #${attempt} (${fam} @${i}, wait ${delayMs}ms): ${message}\n`
              ),
          }
        );
        for (const r of rowsRead) storedHands.set(`${fam}|${r.user_id}`, Number(r.hands));
      }
    }
    const plan = planOpponentHudBackfill({
      profiles: profiles.values(),
      storedHands,
      sinceMs: Date.parse(since ?? ''),
      firstRetainedMs,
      forceRequested: flag('--force'),
    });
    if (!plan.ok) throw new Error(`refused: ${plan.refusal}`);
    const kept = plan.kept.length;
    const rows: object[] = [];
    for (const p of plan.write) {
      rows.push({
        user_id: p.user,
        family: p.family,
        version: p.v,
        hands: p.hands,
        wm_ms: Math.round(p.wm),
        profile: p,
        rebuild: true,
      });
    }
    console.log(`KEPT ${kept} stored profiles that hold more hands than this rebuild read`);
    for (const fam of HUD_FAMILIES)
      rows.push({
        user_id: '*',
        family: fam,
        version: 1,
        hands: 0,
        wm_ms: Math.round(lastHandAt),
        profile: s.priors[fam],
        rebuild: true,
      });
    // save calls of at most 25 rows and 1.5 MB (a busy Horse's three day lists make his row several times the median)
    let written = 0;
    let calls = 0;
    let maxCallBytes = 0;
    const refusedKeys: string[] = [];
    for (let i = 0; i < rows.length; ) {
      const batch: object[] = [];
      let bytes = 0;
      while (i < rows.length && batch.length < 25) {
        const size = Buffer.byteLength(JSON.stringify(rows[i]));
        if (batch.length && bytes + size > 1_500_000) break;
        batch.push(rows[i++]);
        bytes += size;
      }
      const refused = await withTransientBackfillRetry(
        async () => {
          const { data, error } = await paced(() =>
            client.rpc('fn_opponent_hud_profiles_upsert', { p_rows: batch })
          );
          if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
          return (data ?? []) as string[];
        },
        {
          onRetry: ({ attempt, delayMs, message }) =>
            process.stderr.write(
              `upsert retry #${attempt} (@${i}, wait ${delayMs}ms): ${message}\n`
            ),
        }
      );
      refusedKeys.push(...refused);
      written += batch.length - refused.length;
      calls += 1;
      maxCallBytes = Math.max(maxCallBytes, bytes);
    }
    console.log(`SAVE CALLS ${calls} largest ${maxCallBytes} bytes refused ${refusedKeys.length}`);
    console.log(`APPLIED rows ${rows.length} written ${written}`);
  }
}

main().then(
  () => {
    process.stdout.write('', () => {
      process.stderr.write('', () => process.exit(0));
    });
  },
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.stderr.write('', () => process.exit(1));
  }
);
void readFileSync;
