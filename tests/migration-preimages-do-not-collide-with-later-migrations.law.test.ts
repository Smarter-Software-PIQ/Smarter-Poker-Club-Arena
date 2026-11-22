/**
 * LAW: migration pre-image MD5 pins never collide with an earlier migration's post-image MD5.
 * ═══════════════════════════════════════════════════════════════════════════
 * When an earlier or concurrent migration in `supabase/migrations/` already
 * rewrites `schema.fn(args)` to post-image MD5 `Y`, a later migration
 * (>= 20261120000000) that still pins expected pre-image MD5 `X` (`X != Y`)
 * is guaranteed to fail with "pre-image drifted" on install. This law catches
 * those collisions statically before merge.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  PREIMAGE_COLLISION_CHECKED_FROM,
  checkMigrationsDir,
  findPreimageCollisions,
  isPreimageCollisionChecked,
  normalizeSignature,
} from '../scripts/ci/check-migration-preimage-collisions.mjs';

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

const MD5_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MD5_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MD5_C = 'cccccccccccccccccccccccccccccccc';

describe('migration pre-image MD5 freshness check', () => {
  it('flags a collision when an earlier VALUES substitution produces post-image Y != X', () => {
    const migrations = [
      {
        file: 'supabase/migrations/20261119181500_earlier.sql',
        sql: `
          DO $subs$
          BEGIN
            FOR r IN SELECT * FROM (VALUES
              ('public.fn_sample(uuid)', '${MD5_A}', '${MD5_B}', ARRAY[$o$old$o$], ARRAY[$n$new$n$])
            ) AS t(sig, pre_md5, post_md5, olds, news) LOOP NULL; END LOOP;
          END $subs$;
        `,
      },
      {
        file: 'supabase/migrations/20261120120000_stale_pin.sql',
        sql: `
          DO $subs$
          BEGIN
            FOR r IN SELECT * FROM (VALUES
              ('public.fn_sample(uuid)', '${MD5_A}', '${MD5_C}', ARRAY[$o$old$o$], ARRAY[$n$newer$n$])
            ) AS t(sig, pre_md5, post_md5, olds, news) LOOP NULL; END LOOP;
          END $subs$;
        `,
      },
    ];

    const collisions = findPreimageCollisions(migrations);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      file: 'supabase/migrations/20261120120000_stale_pin.sql',
      signature: 'public.fn_sample(uuid)',
      expectedPreMd5: MD5_A,
      earlierFile: 'supabase/migrations/20261119181500_earlier.sql',
      earlierPostMd5: MD5_B,
    });
  });

  it('flags a collision when an earlier @live-proof / DO $post$ produces Y != X for a direct md5 pin', () => {
    const migrations = [
      {
        file: 'supabase/migrations/20261120010000_first.sql',
        sql: `
          -- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_direct(uuid, timestamp with time zone)'::regprocedure)) = '${MD5_B}')
          DO $pins$
          BEGIN
            IF md5(pg_get_functiondef('public.fn_direct(uuid, timestamp with time zone)'::regprocedure))
                 IS DISTINCT FROM '${MD5_A}' THEN
              RAISE EXCEPTION 'pre-image drifted';
            END IF;
          END $pins$;
        `,
      },
      {
        file: 'supabase/migrations/20261120020000_second_stale.sql',
        sql: `
          DO $pins$
          BEGIN
            IF md5(pg_get_functiondef(to_regprocedure('public.fn_direct(uuid, timestamptz)')))
                 IS DISTINCT FROM '${MD5_A}' THEN
              RAISE EXCEPTION 'pre-image drifted';
            END IF;
          END $pins$;
        `,
      },
    ];

    const collisions = findPreimageCollisions(migrations);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      file: 'supabase/migrations/20261120020000_second_stale.sql',
      expectedPreMd5: MD5_A,
      earlierFile: 'supabase/migrations/20261120010000_first.sql',
      earlierPostMd5: MD5_B,
    });
  });

  it('passes clean chaining when the later migration pins post-image Y from the earlier migration', () => {
    const migrations = [
      {
        file: 'supabase/migrations/20261120010000_first.sql',
        sql: `
          DO $subs$
          BEGIN
            FOR r IN SELECT * FROM (VALUES
              ('public.fn_chained(uuid)', '${MD5_A}', '${MD5_B}', ARRAY[$o$a$o$], ARRAY[$n$b$n$])
            ) AS t(sig, pre_md5, post_md5, olds, news) LOOP NULL; END LOOP;
          END $subs$;
        `,
      },
      {
        file: 'supabase/migrations/20261120020000_second_chained.sql',
        sql: `
          DO $subs$
          BEGIN
            FOR r IN SELECT * FROM (VALUES
              ('public.fn_chained(uuid)', '${MD5_B}', '${MD5_C}', ARRAY[$o$b$o$], ARRAY[$n$c$n$])
            ) AS t(sig, pre_md5, post_md5, olds, news) LOOP NULL; END LOOP;
          END $subs$;
        `,
      },
    ];

    expect(findPreimageCollisions(migrations)).toEqual([]);
  });

  it('passes when the later migration explicitly accepts Y via NOT IN (...)', () => {
    const migrations = [
      {
        file: 'supabase/migrations/20261120010000_first.sql',
        sql: `
          -- @live-proof: md5(pg_get_functiondef('public.fn_multi(uuid)'::regprocedure)) = '${MD5_B}'
          SELECT 1;
        `,
      },
      {
        file: 'supabase/migrations/20261120020000_accepts_both.sql',
        sql: `
          DO $pins$
          BEGIN
            IF md5(pg_get_functiondef('public.fn_multi(uuid)'::regprocedure))
                 NOT IN ('${MD5_A}', '${MD5_B}') THEN
              RAISE EXCEPTION 'pre-image drifted';
            END IF;
          END $pins$;
        `,
      },
    ];

    expect(findPreimageCollisions(migrations)).toEqual([]);
  });

  it('normalizes regprocedure type aliases and checks timestamp boundary >= 20261120000000', () => {
    expect(PREIMAGE_COLLISION_CHECKED_FROM).toBe('20261120000000');
    expect(isPreimageCollisionChecked('20261119235959_old.sql')).toBe(false);
    expect(isPreimageCollisionChecked('20261120000000_new.sql')).toBe(true);
    expect(normalizeSignature('public.fn_x(uuid, timestamptz, int4)')).toBe(
      normalizeSignature('public.fn_x(uuid, timestamp with time zone, integer)')
    );
  });

  it('all existing migrations >= 20261120000000 in supabase/migrations have zero pre-image collisions', () => {
    const { checkedCount, collisions } = checkMigrationsDir(MIGRATIONS_DIR);
    expect(checkedCount).toBeGreaterThan(0);
    expect(collisions).toEqual([]);
  });
});
