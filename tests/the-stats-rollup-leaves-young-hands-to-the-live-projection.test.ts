/**
 * The stats roll-up leaves young hands to the live projection (2026-11-11).
 *
 * ca_roll_hand_stats_forward() inserted ca_hand_player_stat rows for hands up
 * to now(), inside a transaction of up to 100 s, so the live post-commit
 * projection inserting the same (user_id, hand_id) waited on it and timed out
 * at :00/:15/:30/:45 (cash hands dealt late). The upper bound is now the
 * earlier of now() - 5 minutes and the oldest open writer's start, and a
 * player-hand with a fact revision is skipped; everything else is the live body.
 *
 * This pins the bound in the newest migration that defines the function, and
 * that the migration keeps the rest exactly (reverse-substitution md5 pin,
 * authority checks). The behaviour is proved natively on PostgreSQL 17 by
 * scripts/ci/test-stats-rollup-lag.py.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationCorpus } from './helpers/migrationCorpus';

const SELF = '20261111031027_the_stats_rollup_leaves_young_hands_to_the_live_projection.sql';
const MIG = readFileSync(resolve(process.cwd(), 'supabase/migrations', SELF), 'utf8');
const PRE = readFileSync(
  resolve(process.cwd(), 'scripts/ci/probes/stats-rollup-lag/live-predecessor.sql'),
  'utf8'
);
const BOUND =
  "  v_now timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));\n";
const OLD2 =
  '    FROM public.ca_hand_player_facts(v_ceil, v_end) f\n    ORDER BY f.user_id, f.hand_id\n';
const NEW2 =
  '    FROM public.ca_hand_player_facts(v_ceil, v_end) f\n' +
  '    WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = f.hand_id AND r.user_id = f.user_id)\n' +
  '    ORDER BY f.user_id, f.hand_id\n';
const DEFINES = /create\s+(or\s+replace\s+)?function\s+public\.ca_roll_hand_stats_forward\s*\(/i;

describe('the stats roll-up leaves young hands to the live projection', () => {
  it('is the newest migration that defines the roll-up', () => {
    const definers = migrationCorpus()
      .filter(({ sql }) => DEFINES.test(sql))
      .map(({ name }) => name);
    expect(definers[definers.length - 1]).toBe(SELF);
  });

  it('changes only the upper bound and the revision skip of the live body', () => {
    const start = MIG.search(DEFINES);
    const end =
      MIG.indexOf('$function$', MIG.indexOf('$function$', start) + 1) + '$function$'.length;
    const body = MIG.slice(start, end) + '\n';
    expect(body.split(BOUND)).toHaveLength(2);
    expect(body.split(NEW2)).toHaveLength(2);
    expect(body.replace(BOUND, '  v_now timestamptz := now();\n').replace(NEW2, OLD2)).toBe(PRE);
  });

  it('refuses any other body or authority, before and after', () => {
    expect(MIG.match(/'07f9ad834d98b1944eecbab0439f63fb'/g)).toHaveLength(3);
    expect(MIG.match(/authority changed/g)).toHaveLength(2);
    expect(MIG).toContain("p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'");
    expect(MIG).toContain("p.proconfig::text = '{search_path=public,statement_timeout=4min}'");
  });

  it('is one transaction', () => {
    expect(MIG.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIG.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
