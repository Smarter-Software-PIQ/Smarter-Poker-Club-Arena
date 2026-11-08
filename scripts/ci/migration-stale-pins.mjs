/**
 * A MIGRATION MOVES THE PINS ON WHAT IT CHANGES (2026-11-07).
 *
 * Functions here pin other functions' bodies by md5 (`md5(pg_get_functiondef(
 * ...)) IS DISTINCT FROM '<32 hex>'`, or a list of signature/md5 pairs) and
 * quietly fall back, return NULL or refuse when the pinned body changes.
 * 20261107021911 changed fn_union_pnl_evidence_report and left two such pins
 * on its old body: smarter_private.original_inventory_proof_sources_match()
 * went false, the original-inventory generation went NULL, close certificates
 * stopped being kept and the 2026-10-19 Midway close could not finish
 * (moved by 20261107234051). Nothing failed; the install looked clean.
 *
 * The applier now asks, inside the migration's own transaction, before it
 * records history: did this migration change or drop a function whose OLD
 * body md5 still appears in the source of any installed function? If so the
 * transaction is refused (rolled back, nothing installed). The old md5 is
 * taken under both search paths a pin can be computed with (pg_catalog, and
 * public): pg_get_functiondef prints a user-defined type without its schema
 * when that schema is on the path. Cost on production 2026-11-07: about 0.2 s
 * per pass over the 5,965 functions in public and smarter_private (three
 * passes: two snapshots, one comparison; 0.6 s in all). A change made inside a
 * subtransaction (a DO block with an EXCEPTION clause) is found the same way.
 *
 * A pin that is meant to keep naming a former body (a list of accepted
 * bodies, say) is declared in the migration, one per line, before BEGIN:
 *   -- @stale-pin-ok: <md5> <why>
 * Applies to migrations from PIN_CHECKED_FROM on.
 */

export const PIN_CHECKED_FROM = '20261108000000';

export const isPinChecked = (file) =>
  /(?:^|\/)(\d{14})_[^/]+\.sql$/.test(file) &&
  file.match(/(?:^|\/)(\d{14})_/)[1] >= PIN_CHECKED_FROM;

/** The md5s a migration declares may stay pinned after it changes them. */
export function allowedStalePins(sql) {
  return [...sql.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map((m) => m[1]);
}

// The snapshot lives in a transaction-local setting, not a temporary table:
// creating a table is DDL, and DDL makes PostgREST reload its schema cache
// (about 28 s here) even for a migration that only moves data.
const SNAPSHOT = `
DO $ca_stale_pin_snapshot$
DECLARE previous text := current_setting('search_path'); snap jsonb;
BEGIN
 PERFORM set_config('search_path', 'pg_catalog', true);
 SELECT jsonb_object_agg(p.oid::text, jsonb_build_array(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))))
   INTO snap
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind IN ('f', 'p');
 PERFORM set_config('search_path', 'public', true);
 SELECT jsonb_object_agg(k, snap->k || jsonb_build_array(md5(pg_catalog.pg_get_functiondef(k::pg_catalog.oid))))
   INTO snap FROM pg_catalog.jsonb_object_keys(snap) k;
 PERFORM pg_catalog.set_config('search_path', previous, true);
 PERFORM pg_catalog.set_config('ca.stale_pin_before', COALESCE(snap, '{}'::jsonb)::text, true);
END $ca_stale_pin_snapshot$;`;

function checkSQL(allowed) {
  const allow = allowed.length
    ? `ARRAY[${allowed.map((m) => `'${m}'`).join(',')}]::text[]`
    : `ARRAY[]::text[]`;
  return `
DO $ca_stale_pin_check$
DECLARE previous text := current_setting('search_path'); stale text;
BEGIN
 PERFORM set_config('search_path', 'pg_catalog', true);
 WITH before AS MATERIALIZED (
  SELECT e.key::oid AS oid, e.value->>0 AS signature, e.value->>1 AS catalog_md5, e.value->>2 AS public_md5
    FROM jsonb_each(current_setting('ca.stale_pin_before')::jsonb) e
 ), changed AS MATERIALIZED (
  SELECT b.* FROM before b LEFT JOIN pg_catalog.pg_proc p ON p.oid = b.oid
   WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM b.catalog_md5
 ), old_md5 AS MATERIALIZED (
  SELECT DISTINCT c.signature, x.md5 FROM changed c CROSS JOIN LATERAL (VALUES (c.catalog_md5), (c.public_md5)) x(md5)
   WHERE x.md5 IS NOT NULL AND x.md5 <> ALL (${allow})
 )
 SELECT string_agg(DISTINCT o.signature || ' (old md5 ' || o.md5 || ') is still pinned by ' || q.oid::regprocedure::text, '; ')
   INTO stale
   FROM old_md5 o JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, o.md5) > 0;
 PERFORM pg_catalog.set_config('search_path', previous, true);
 IF stale IS NOT NULL THEN
  RAISE EXCEPTION 'migration_left_a_stale_pin: %', stale
   USING ERRCODE = '55000',
   HINT = 'Move the pin to the new body in this migration, or declare -- @stale-pin-ok: <md5> <why>.';
 END IF;
END $ca_stale_pin_check$;`;
}

/**
 * The two pieces the applier splices into a migration's own transaction: the
 * snapshot (right after BEGIN;) and the check (right before the history
 * insert and COMMIT;). Both are '' for files before PIN_CHECKED_FROM.
 */
export function stalePinParts(file, source, body) {
  if (!isPinChecked(file)) return { snapshot: '', check: '' };
  if (!/^[ \t]*BEGIN[ \t]*;/im.test(body) || !/COMMIT\s*;\s*$/i.test(body))
    throw new Error('stale-pin guard requires one BEGIN; ... COMMIT; transaction');
  if (body.includes('$ca_stale_pin_snapshot$') || body.includes('$ca_stale_pin_check$'))
    throw new Error('migration conflicts with the reserved stale-pin delimiters');
  return { snapshot: '\n' + SNAPSHOT, check: checkSQL(allowedStalePins(source)) + '\n' };
}

/**
 * Wrap a migration's atomic SQL (BEGIN; ... COMMIT;) the way the applier does:
 * snapshot right after BEGIN, check right before the final COMMIT.
 */
export function stalePinGuardSQL(file, source, atomicSQL) {
  const { snapshot, check } = stalePinParts(file, source, atomicSQL);
  if (!snapshot) return atomicSQL;
  return atomicSQL
    .replace(/COMMIT\s*;\s*$/i, () => check + 'COMMIT;')
    .replace(/^([ \t]*BEGIN[ \t]*;)/im, (b) => b + snapshot);
}
