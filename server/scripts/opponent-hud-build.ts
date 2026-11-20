/**
 * OPPONENT HUD BUILD (2026-11-20, PLO-OWNER lane OPPONENT-HUD): backfill, reconciliation and dry run of the lifetime
 * public opponent profiles (server/src/engine/opponentHud/OpponentHudProfile.ts).
 *
 *   npx tsx server/scripts/opponent-hud-build.ts --from-db --since 2026-10-01 [--until ISO] --dry-run --out FILE
 *   npx tsx server/scripts/opponent-hud-build.ts --from-db --since 2026-10-01 --apply          (backfill, rebuild)
 *   npx tsx server/scripts/opponent-hud-build.ts --from-jsonl FILE --dry-run --out FILE        (offline copy)
 *
 * Source: fn_opponent_hud_hands_page (public fields only; the dealt cards never leave the database) or a JSON-lines
 * copy of the same rows. Every hand goes through the same handRecordFromRow / applyHudHand the engine uses, oldest
 * first, so a backfilled profile is exactly what the live engine would have built hand by hand. The population row
 * ('*') holds fitHudPriors of the result. --apply writes with rebuild=true (a backfill replaces the stored row);
 * (The nightly reconciliation runs in the engine: OpponentHudStore.reconcileDay, which compares each profile's day
 * list with hand_history and repairs any missing hand; a lifetime rebuild cannot reconcile a Horse because hands with
 * no person are purged after 7 days.)
 * Operators only. Never prints a card (there is none in the input).
 */
import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  HUD_STATS,
  applyHudHandToProfiles,
  emptyHudProfile,
  handRecordFromRow,
  type HudFamily,
  type OpponentHudProfile,
} from '../src/engine/opponentHud/OpponentHudProfile.js';
import {
  fitHudPriors,
  hudStakeBand,
  type HudPopulation,
} from '../src/engine/opponentHud/OpponentHud.js';
import { extractHandDeltas } from '../src/engine/opponentHud/OpponentHudProfile.js';

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
const t0 = Date.now();

function take(row: unknown): void {
  const rec = handRecordFromRow(row);
  if (typeof rec === 'string') {
    refusals.set(rec, (refusals.get(rec) ?? 0) + 1);
    return;
  }
  hands += 1;
  // pooled counts per family and stake band: the stake priors of a new opponent
  const band = hudStakeBand(rec.bb);
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

async function fromJsonl(file: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) take(JSON.parse(line));
}

async function db() {
  return (await import('../src/services/supabase.js')).supabase;
}

async function fromDb(since: string, until: string): Promise<void> {
  const client = await db();
  let afterAt = since;
  let afterId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { data, error } = await client.rpc('fn_opponent_hud_hands_page', {
      p_after_at: afterAt,
      p_after_id: afterId,
      p_until: until,
      p_limit: 1500,
    });
    if (error) throw new Error(`hands page failed: ${error.message}`);
    const rows = (data ?? []) as { id: string; created_at: string }[];
    for (const r of rows) take(r);
    if (rows.length) {
      afterAt = rows[rows.length - 1].created_at;
      afterId = rows[rows.length - 1].id;
    }
    process.stderr.write(`hands ${hands} through ${afterAt}\n`);
    if (rows.length < 1500) break;
  }
}

function summary() {
  const sizes = [...profiles.values()].map((p) => JSON.stringify(p).length).sort((a, b) => a - b);
  const q = (f: number) => sizes[Math.min(sizes.length - 1, Math.floor(f * sizes.length))] ?? 0;
  const byFamily: Record<string, number> = {};
  for (const p of profiles.values()) byFamily[p.family] = (byFamily[p.family] ?? 0) + 1;
  const priors: Record<string, HudPopulation> = {};
  for (const fam of ['plo4', 'plo5'] as HudFamily[]) {
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
  else if (flag('--from-db'))
    await fromDb(
      opt('--since') ?? '2026-01-01T00:00:00Z',
      opt('--until') ?? new Date().toISOString()
    );
  else throw new Error('--from-jsonl FILE or --from-db');
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
    // A stored profile with MORE hands than this rebuild keeps history hand_history no longer holds (hands with no
    // person are purged after 7 days): it is never replaced unless --force. Every other row is rebuilt.
    const storedHands = new Map<string, number>();
    for (const fam of ['plo4', 'plo5'] as HudFamily[]) {
      const users = [...profiles.values()].filter((p) => p.family === fam).map((p) => p.user);
      for (let i = 0; i < users.length; i += 50) {
        const { data, error } = await client.rpc('fn_opponent_hud_profiles_read', {
          p_user_ids: users.slice(i, i + 50),
          p_family: fam,
        });
        if (error) throw new Error(`read failed: ${error.message}`);
        for (const r of (data ?? []) as { user_id: string; hands: number }[])
          storedHands.set(`${fam}|${r.user_id}`, Number(r.hands));
      }
    }
    let kept = 0;
    const rows: object[] = [];
    for (const p of profiles.values()) {
      const stored = storedHands.get(`${p.family}|${p.user}`);
      if (stored !== undefined && stored > p.hands && !flag('--force')) {
        kept += 1;
        continue;
      }
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
    console.log(`KEPT ${kept} stored profiles that hold more hands than hand_history still has`);
    for (const fam of ['plo4', 'plo5'] as HudFamily[])
      rows.push({
        user_id: '*',
        family: fam,
        version: 1,
        hands: 0,
        wm_ms: -1,
        profile: s.priors[fam],
        rebuild: true,
      });
    let written = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const { data, error } = await client.rpc('fn_opponent_hud_profiles_upsert', {
        p_rows: rows.slice(i, i + 100),
      });
      if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
      written += 100 - ((data ?? []) as string[]).length;
    }
    console.log(`APPLIED rows ${rows.length} written ${Math.min(written, rows.length)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
void readFileSync;
