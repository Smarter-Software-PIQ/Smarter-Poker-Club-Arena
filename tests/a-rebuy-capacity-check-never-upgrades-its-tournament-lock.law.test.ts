/**
 * LAW: A REBUY'S CAPACITY CHECK NEVER UPGRADES ITS TOURNAMENT LOCK (2026-11-23).
 *
 * A tournament hand commit and a seatless rebuy deadlocked at 05:18:06 UTC on
 * 2026-11-23 (PR #11476, alert 445924, reports the same cycle on 2026-11-19). The
 * hand takes the tournament row FOR KEY SHARE and then its table FOR UPDATE.
 * The rebuy's root takes the tournament row FOR NO KEY UPDATE and the
 * candidate's table FOR UPDATE, then fn_ca_choose_tournament_seat_locked calls
 * fn_ensure_late_registration_capacity, which asked for the tournament row
 * FOR UPDATE: an upgrade that waits for the hand's KEY SHARE while the hand
 * waits for the table. Migration 20261123052751 makes the capacity check take
 * FOR NO KEY UPDATE, the mode its callers' roots already hold. Proved natively
 * by scripts/dev/prove-a-rebuy-capacity-check-never-upgrades-its-tournament-lock.sh
 * on production's own function text.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123052751_a_rebuy_capacity_check_never_upgrades_its_tournament_lock.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const FIXTURE = resolve(
  ROOT,
  'scripts/dev/fixtures/a-rebuy-capacity-check-never-upgrades-its-tournament-lock/fn_ensure_late_registration_capacity.preimage.sql'
);
const OLD =
  '  SELECT * INTO v_t\n    FROM public.tournaments t\n   WHERE t.id=p_tournament_id\n   FOR UPDATE;';
const NEW =
  '  SELECT * INTO v_t\n    FROM public.tournaments t\n   WHERE t.id=p_tournament_id\n   FOR NO KEY UPDATE;';
const stripComments = (text: string) => text.replace(/--[^\n]*/g, '');
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

describe('the capacity check takes the tournament row in the mode its callers hold', () => {
  it('replaces exactly the one FOR UPDATE with FOR NO KEY UPDATE', () => {
    expect(sql).toContain(`$o$${OLD}$o$`);
    expect(sql).toContain(`$r$${NEW}$r$`);
    expect(sql).toContain(
      "RAISE EXCEPTION 'fn_ensure_late_registration_capacity tournament lock anchor was expected exactly once'"
    );
    expect(sql).toContain(
      'already takes the tournament row FOR NO KEY UPDATE: re-read before editing'
    );
    expect(sql.match(/EXECUTE replace\(v_def,v_old,v_new\);/g)).toHaveLength(1);
  });

  it('refuses to lighten the lock if the function ever deletes a tournament', () => {
    expect(sql).toContain("position('DELETE FROM public.tournaments' IN v_def)>0");
  });

  it('applied to production text, gives the one-token post-image #11476 also expects', () => {
    const pre = readFileSync(FIXTURE, 'utf8');
    expect(md5(pre)).toBe('a539fd43bb2992f8d75253f2d7a4dd7c');
    expect(pre.split(OLD)).toHaveLength(2);
    const post = pre.replace(OLD, NEW);
    expect(md5(post)).toBe('c142f16547e8cde3ba10338c2bf6e6e4');
    expect(post).not.toMatch(/FOR UPDATE/);
  });

  it('nothing in the change reads is_horse or touches money', () => {
    const code = stripComments(sql);
    expect(code).not.toMatch(/is_horse/);
    expect(code).not.toMatch(/chip_balance|chips\s*=|prize|payout|wallet/i);
  });

  it('is one bounded transaction with a probe after the definition', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql.match(/^-- @live-proof: \(SELECT /gm)).toHaveLength(1);
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration puts the capacity check back on FOR UPDATE', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      const head = source.search(
        /CREATE OR REPLACE FUNCTION public\.fn_ensure_late_registration_capacity\s*\(/i
      );
      if (head >= 0) {
        expect(
          stripComments(source.slice(head)),
          `${file} redefines the capacity check with FOR UPDATE on the tournament row`
        ).not.toMatch(/FROM public\.tournaments t\s+WHERE t\.id=p_tournament_id\s+FOR UPDATE/);
      }
      if (
        source.includes('fn_ensure_late_registration_capacity') &&
        source.includes('pg_get_functiondef')
      ) {
        expect(stripComments(source), `${file} rewrites the capacity lock back`).not.toMatch(
          /\$r\$[^$]*WHERE t\.id=p_tournament_id\s+FOR UPDATE;/
        );
      }
    }
  });

  it('the native proof replays the logged deadlock and its fix on production text', () => {
    const proof = readFileSync(
      resolve(
        ROOT,
        'scripts/dev/prove-a-rebuy-capacity-check-never-upgrades-its-tournament-lock.sh'
      ),
      'utf8'
    );
    expect(existsSync(FIXTURE)).toBe(true);
    expect(proof).toContain(`"\${PSQL[@]}" -f "$MIGRATION"`);
    expect(proof).toContain('grep -q \'DEADLOCK\' <<<"$b1"');
    expect(proof).toContain("grep -q 'rebuy: committed true | hand: committed hand'");
    expect(proof).toContain('grep -q \'second: lock timeout\' <<<"$a2"');
    expect(proof).toContain('[ "$b3" = "$a3" ]');
  });
});
