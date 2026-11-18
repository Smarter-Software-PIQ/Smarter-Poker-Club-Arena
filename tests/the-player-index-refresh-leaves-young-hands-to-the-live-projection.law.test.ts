/**
 * The player index refresh leaves young hands to the live projection (2026-11-11).
 *
 * ca_refresh_hand_player_index inserted ca_hand_player_idx rows up to the
 * newest committed hand inside one transaction of up to 90 s, so the live
 * post-commit projection inserting the same (user_id, hand_id) waited on it and
 * timed out at :00/:15/:30/:45, holding the table's post-commit lock while the
 * engine waited to deal. The newest definition must bound its forward loop by
 * the earlier of now() - 5 minutes and the oldest open writer's start, and skip
 * revised player-hands. Behaviour is proved natively by
 * scripts/ci/test-idx-refresh-lag.py.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

const DEFINES = /create\s+or\s+replace\s+function\s+public\.ca_refresh_hand_player_index\s*\(/i;

function newestBody(): string {
  const last = migrationCorpus()
    .filter(({ sql }) => DEFINES.test(sql))
    .pop();
  expect(last).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(DEFINES);
  const open = sql.indexOf('$function$', start);
  return sql.slice(start, sql.indexOf('$function$', open + 1));
}

describe('the player index refresh leaves young hands to the live projection', () => {
  it('bounds the forward loop below the oldest open writer and five minutes ago', () => {
    const body = newestBody();
    expect(body).toContain("v_bound timestamptz := least(now() - interval '5 minutes'");
    expect(body).toContain('min(a.xact_start) FROM pg_catalog.pg_stat_activity a');
    expect(body).toContain(
      'WHERE created_at > c AND created_at < v_bound ORDER BY created_at, id LIMIT v_chunk'
    );
  });

  it('never re-inserts a revised player-hand', () => {
    expect(newestBody()).toContain(
      'WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = e.hand_id AND r.user_id = e.user_id)'
    );
  });
});
