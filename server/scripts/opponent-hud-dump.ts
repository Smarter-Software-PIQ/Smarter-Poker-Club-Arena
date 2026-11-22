/**
 * OPPONENT HUD DUMP (operators only; never shown to players): print the lifetime public profile the Horses hold on
 * one opponent, the "heads-up display" (2026-11-20, PLO-OWNER lane OPPONENT-HUD).
 *
 *   npx tsx server/scripts/opponent-hud-dump.ts <user-uuid> [plo4|plo5] [--file profiles.json]
 *
 * Reads the stored row (fn_opponent_hud_profiles_read) or a dry-run file, and prints each statistic as his raw rate
 * with its opportunities, the population prior and k, and the shrunk read the decisions use; then his most observed
 * spots (hand-level recall) and his latest instances. Public information only: the profile holds no card.
 */
import { readFileSync } from 'node:fs';
import {
  HUD_STATS,
  familyForVariant,
  type HudFamily,
  type OpponentHudProfile,
} from '../src/engine/opponentHud/OpponentHudProfile.js';
import { blendedCount, type HudPriors } from '../src/engine/opponentHud/OpponentHud.js';

const [user, famArg] = process.argv.slice(2);
const family: HudFamily = familyForVariant(famArg) ?? 'plo5';
const fileIdx = process.argv.indexOf('--file');

async function load(): Promise<{ profile: OpponentHudProfile | null; priors: HudPriors }> {
  if (fileIdx > 0) {
    const d = JSON.parse(readFileSync(process.argv[fileIdx + 1], 'utf8'));
    return {
      profile:
        (d.profiles as OpponentHudProfile[]).find((p) => p.user === user && p.family === family) ??
        null,
      priors: d.summary?.priors?.[family] ?? {},
    };
  }
  const { supabase } = await import('../src/services/supabase.js');
  const { data, error } = await supabase.rpc('fn_opponent_hud_profiles_read', {
    p_user_ids: [user, '*'],
    p_family: family,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { user_id: string; profile: unknown }[];
  return {
    profile: (rows.find((r) => r.user_id === user)?.profile as OpponentHudProfile) ?? null,
    priors: (rows.find((r) => r.user_id === '*')?.profile as HudPriors) ?? {},
  };
}

async function main() {
  if (!user) throw new Error('usage: opponent-hud-dump.ts <user-uuid> [plo4|plo5] [--file f]');
  const { profile: p, priors } = await load();
  if (!p) {
    console.log(`no ${family} profile for ${user}: the Horses read him at the population prior`);
    return;
  }
  const now = Date.now();
  console.log(
    `OPPONENT HUD ${family} ${user}  lifetime hands ${p.hands}  last hand ${new Date(p.wm).toISOString()}`
  );
  const listed = Object.entries(p.days ?? {})
    .sort()
    .map(([d, ids]) => `${d}: ${ids.length}`)
    .join(', ');
  console.log(
    `hands counted on the listed days (the idempotency key and the nightly verification): ${listed || 'none'}`
  );
  console.log(
    p.ses
      ? `current session (responses to a first wager): ${p.ses.m} responses, ${p.ses.f} folds, last ${new Date(p.ses.at).toISOString()}`
      : 'current session (responses to a first wager): none'
  );
  console.log(
    'stat'.padEnd(18),
    'raw'.padStart(7),
    'opps'.padStart(8),
    'blended n'.padStart(10),
    'prior'.padStart(7),
    'k'.padStart(6),
    'READ'.padStart(7)
  );
  for (const s of HUD_STATS) {
    const life = p.life[s];
    if (!life || !(life[0] > 0)) continue;
    const [n, h] = blendedCount(p, s, now);
    const [pr, k] = priors[s] ?? [NaN, 20];
    const read = Number.isFinite(pr) ? (h + k * pr) / (n + k) : h / n;
    console.log(
      s.padEnd(18),
      (life[1] / life[0]).toFixed(3).padStart(7),
      String(Math.round(life[0])).padStart(8),
      n.toFixed(1).padStart(10),
      (Number.isFinite(pr) ? pr.toFixed(3) : '-').padStart(7),
      k.toFixed(0).padStart(6),
      read.toFixed(3).padStart(7)
    );
  }
  console.log(
    '\nMOST OBSERVED SPOTS (instances: fold/call/raise/check/bet | shown, shown straight+, won)'
  );
  const cells = Object.entries(p.recall)
    .filter(([k]) => k.split('|').length <= 3)
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, 40);
  for (const [k, c] of cells)
    console.log(
      k.padEnd(22),
      String(c[0]).padStart(6),
      ` ${c[1]}/${c[2]}/${c[3]}/${c[4]}/${c[5]} | ${c[6]}, ${c[7]}, ${c[8]}`
    );
  console.log('\nLATEST INSTANCES');
  for (const i of p.last.slice(-20))
    console.log(
      new Date(i.at).toISOString().slice(0, 16),
      i.s.padEnd(7),
      i.ln.padEnd(4),
      i.b,
      i.pos.padEnd(3),
      i.tx.padEnd(6),
      i.d,
      '->',
      i.a,
      i.sh ? `shown ${i.sh === 2 ? 'straight+' : 'weaker'}` : '',
      i.w ? 'won' : ''
    );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
