/**
 * A LIGHTNING TOP-UP NEVER BUYS OVER A PENDING REBUY (2026-11-19).
 *
 * Every stranded Lightning feeder rebuy found on 2026-11-19 was a double
 * purchase: fn_lightning_auto_rebuy debited a pending 400 rebuy and, seconds
 * later at the same boundary, fn_lightning_top_up_request debited and landed a
 * second 400. The auto-rebuy door refused while an add-on was pending; the
 * top-up door looked only at its own intents. The top-up door must refuse while
 * the caller has an unresolved table_pending_addons row on that table, before
 * it writes an intent or moves a chip, and the rule reads no horse identity:
 * the browser and the horse input device reach the same door (CLAUDE.md 10.5).
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

const FILE = '20261119050653_a_lightning_top_up_never_buys_over_a_pending_rebuy.sql';

function patch(): { sql: string; inserted: string } {
  const m = migrationCorpus().find((f) => f.name === FILE);
  expect(m, `${FILE} exists`).toBeDefined();
  const sql = m!.sql;
  const open = sql.indexOf('v_new text := $f$');
  expect(open).toBeGreaterThan(0);
  const inserted = sql.slice(open, sql.indexOf('$f$;', open + 20));
  return { sql, inserted };
}

describe('a Lightning top-up never buys over a pending rebuy', () => {
  it('refuses while the caller has an unresolved pending add-on on this table', () => {
    const { inserted } = patch();
    expect(inserted).toMatch(
      /IF EXISTS\(SELECT 1 FROM public\.table_pending_addons a WHERE a\.table_id=p_table_id\s+AND a\.user_id=p_user_id AND a\.resolved_at IS NULL\) THEN/
    );
    expect(inserted).toContain("RETURN jsonb_build_object('success',false,'error','A Rebuy Is Already Pending For This Seat');");
  });

  it('decides before any intent row or debit, beside the existing pending refusal', () => {
    const { inserted } = patch();
    expect(inserted.indexOf('A Lightning Top Up Is Already Pending')).toBeLessThan(
      inserted.indexOf('table_pending_addons')
    );
    expect(inserted).not.toMatch(/INSERT INTO|lightning_top_up_finish/);
  });

  it('reads no horse identity: one rule for every player', () => {
    const { inserted } = patch();
    expect(inserted).not.toMatch(/is_horse|horse/i);
  });

  it('patches the live body only against its asserted pre-image and proves the result', () => {
    const { sql } = patch();
    expect(sql).toContain("to_regprocedure('public.fn_lightning_top_up_request(uuid,uuid,text,numeric)')");
    expect(sql).toMatch(/md5\(v_def\) <> '[0-9a-f]{32}'/);
    expect(sql).toContain('PRE_IMAGE_ANCHOR');
    expect(sql).toMatch(/strpos\(pg_get_functiondef\(v_oid\), 'A Rebuy Is Already Pending For This Seat'\) = 0/);
  });

  it('the engine treats the refusal as a refusal, never as a malformed receipt', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('server/src/lightning/LightningTopUp.ts', 'utf8');
    expect(src).toContain("if (data?.success === false && !data?.status)");
  });
});
