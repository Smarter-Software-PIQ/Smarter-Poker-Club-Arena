/**
 * A DIAMOND SPINS PAYOUT LOCKS ITS BANKS WITHOUT BLOCKING FOREIGN KEYS (2026-11-27).
 *
 * Deadlock 40P01 at 2026-11-26 02:33:27.913 UTC (8:33 PM Chicago, 2026-11-25):
 *
 *   - A horse's Midway Free Buy registration inserted its tournament_players
 *     row naming its club, so tournament_players_club_id_fkey held FOR KEY
 *     SHARE on that clubs row; it then waited at
 *     fn_ca_midway_free_buy_promo_head line 88 to UPDATE the Midway
 *     union_wallets row.
 *   - A horse's Diamond Spins payout (fn_horse_diamond_spins ->
 *     fn_wheel_spin_v5 -> fn_diamond_game_pay_chips) held that union_wallets
 *     row through fn_diamond_game_cover_lock and waited to take the same
 *     clubs row FOR UPDATE, the only row lock that conflicts with FOR KEY
 *     SHARE.
 *
 * The repo's bank-row rule (tests/a-tournament-start-does-not-block-foreign-
 * keys.law.test.ts): a treasury lock on public.clubs or public.union_wallets
 * is FOR NO KEY UPDATE, never FOR UPDATE. Migration 20261127004231 brings the
 * two Diamond games functions that broke it into it. Reproduced natively on
 * PostgreSQL 16 with production's md5-pinned bodies: deadlock before, none
 * after, two payouts from one bank still serialise.
 *
 * Every window here is bounded by structure (a dollar-quoted block, a
 * function body, a VALUES tuple), never by a byte count.
 */
import { describe, expect, it } from 'vitest';
import { functionBody, migrationFiles, readMigration } from './helpers/migrations';
import { sliceDollarQuoted } from './helpers/sourceWindow';

const MIGRATION = '20261127004231_a_diamond_spins_payout_locks_the_club_bank_without_blocking_.sql';
const sql = readMigration(MIGRATION);

const PAY = 'public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)';
const COVER = 'public.fn_diamond_game_cover_lock(uuid,text)';

/** The live statements that took FOR UPDATE on a bank row, by function. */
const BANK_LOCKS: Record<string, string[]> = {
  [PAY]: ['FROM public.clubs WHERE id = p_club FOR UPDATE;'],
  [COVER]: [
    'FROM public.union_wallets w WHERE w.union_id = p_host FOR UPDATE;',
    'FROM public.clubs c WHERE c.id = p_host FOR UPDATE;',
  ],
};
const PRE: Record<string, string> = {
  [PAY]: '5f28dcec52d99dc520ab3c96588b38bc',
  [COVER]: '27cc81bfcac08913d31cc4a7c381fd06',
};
const POST: Record<string, string> = {
  [PAY]: '9294809778c5ea1dbd41e87a8667a2c8',
  [COVER]: 'e8c34d2ffbf055e13f22a2ab6573daf2',
};

/** One VALUES tuple of the rewrite block: from its function literal to the ARRAY's closing bracket. */
function tupleFor(block: string, fn: string): string {
  const start = block.indexOf(`('${fn}',`);
  expect(start, `${fn} is not rewritten`).toBeGreaterThanOrEqual(0);
  const arrayAt = block.indexOf('ARRAY[', start);
  const close = block.indexOf(']', arrayAt);
  expect(arrayAt).toBeGreaterThan(start);
  return block.slice(start, close + 1);
}

/** The single-quoted literals of an ARRAY[...] in a tuple. */
function anchorsOf(tuple: string): string[] {
  const arr = tuple.slice(tuple.indexOf('ARRAY['));
  return [...arr.matchAll(/'((?:''|[^'])*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

const BANK_FOR_UPDATE = /FROM\s+public\.(?:clubs|union_wallets)\b[^;]*?\bFOR\s+UPDATE\b/i;

describe('a Diamond Spins payout locks its banks without blocking foreign-key checks', () => {
  const rewrite = sliceDollarQuoted(sql, '$migration$');

  it.each([PAY, COVER])(
    '%s: every bank FOR UPDATE becomes FOR NO KEY UPDATE, and nothing else changes',
    (fn) => {
      const tuple = tupleFor(rewrite, fn);
      expect(tuple).toContain(`'${PRE[fn]}'`);
      expect(tuple).toContain(`'${POST[fn]}'`);
      expect(anchorsOf(tuple)).toEqual(BANK_LOCKS[fn]);
      for (const anchor of BANK_LOCKS[fn]) expect(anchor).toMatch(BANK_FOR_UPDATE);
    }
  );

  it('rewrites only the anchors, each found exactly once, from the reviewed pre-image', () => {
    expect(rewrite).toContain("replace(f.anchors[i], ' FOR UPDATE;', ' FOR NO KEY UPDATE;')");
    expect(rewrite).toMatch(/IF v_n <> 1 THEN\s+RAISE EXCEPTION/);
    expect(rewrite).toMatch(/IF md5\(v_src\) <> f\.pre_md5 THEN\s+RAISE EXCEPTION/);
    expect(rewrite).toMatch(/IF md5\(v_src\) = f\.post_md5 THEN[\s\S]*?CONTINUE;/);
    expect(rewrite).toContain('EXECUTE v_def;');
  });

  it('asserts the post-image, the absence of FOR UPDATE and unchanged grants before COMMIT', () => {
    const post = sliceDollarQuoted(sql, '$post$');
    expect(post).toContain(`'${POST[PAY]}'`);
    expect(post).toContain(`'${POST[COVER]}'`);
    expect(post).toContain("position('FOR UPDATE' in r.prosrc) > 0");
    expect(post).toContain("'{postgres=X/postgres,service_role=X/postgres}'");
    expect(post).toContain('r.prosecdef');
    expect(post).toContain("ARRAY['search_path=public']");
    expect(sql.indexOf('DO $post$')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
  });

  it('is one short-lock transaction that probes both functions and declares its live proof', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toMatch(/^SET LOCAL lock_timeout = '\d+s';$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_diamond_game_pay_chips$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_diamond_game_cover_lock$/m);
    expect(sql).not.toMatch(/^-- @install-window:/m);
    const proofs = [...sql.matchAll(/^-- @live-proof: (.*)$/gm)].map((m) => m[1]);
    expect(proofs).toHaveLength(2);
    expect(proofs.some((p) => p.includes(PAY) && p.includes(POST[PAY]))).toBe(true);
    expect(proofs.some((p) => p.includes(COVER) && p.includes(POST[COVER]))).toBe(true);
  });

  it('no later migration takes a bank row FOR UPDATE again in either function', () => {
    const later = migrationFiles().filter((f) => f > MIGRATION);
    for (const file of later) {
      const text = readMigration(file);
      for (const name of ['fn_diamond_game_pay_chips', 'fn_diamond_game_cover_lock']) {
        if (
          new RegExp(
            `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`,
            'i'
          ).test(text)
        ) {
          expect(functionBody(text, name), `${file} redefines ${name}`).not.toMatch(
            BANK_FOR_UPDATE
          );
        }
        if (text.includes(`pg_get_functiondef('public.${name}(`) && /\bEXECUTE\b/i.test(text)) {
          expect(text, `${file} rewrites ${name}`).not.toMatch(BANK_FOR_UPDATE);
        }
      }
    }
  });
});
