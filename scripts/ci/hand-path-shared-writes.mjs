/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A HAND'S MONEY PATH NEVER WRITES A SHARED ROW (incident 075013fd, 2026-11-18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS. The same failure has been fixed one row at a time, three
 * times, and nothing ever stopped the fourth:
 *
 *   2026-09-29  clubs.total_rake UPDATE on every raked hand
 *   2026-10-02  club_wallets row on every raked hand (1,518 timeouts)
 *   2026-11-17  union_wallets.rake_wallet on every raked hand (8,303 timeouts,
 *               #11256 / #11270), then the union BBJ pool, its allocator row
 *               and union_wallets.insurance_wallet (#11266)
 *
 * Each time a per-hand transaction took a BLOCKING EXCLUSIVE lock on a row
 * that every table of a club or union shares, so one slow holder (a tournament
 * settlement, a sweep, another hand) queued every hand of that union behind
 * it, and the engine's settlement barrier turned a lock queue into a hand gap.
 *
 * WHAT IT ASKS (one read-only query over the catalog, no table read):
 *
 *   1. THE PER-HAND PATH. The call closure of the hand doors
 *      (HAND_PATH_ROOTS: the settlement commit, the submission commit and the
 *      post-commit envelope), plus every trigger function on every table those
 *      functions INSERT/UPDATE/DELETE whose event matches the statement (an
 *      UPDATE OF trigger only when the statement's SET list assigns one of its
 *      columns, as PostgreSQL fires it: a column named only in the WHERE
 *      clause does not count - setTargets()),
 *      followed transitively up to MAX_CALL_DEPTH calls and MAX_TRIGGER_HOPS
 *      trigger hops. The deferred bankers (HAND_PATH_BANKERS) are excluded:
 *      they touch shared rows OFF the hot path with try-locks and NOWAIT, which
 *      is the whole point of #11270 / #11266.
 *   2. SHARED SCOPE. A table is shared when it has a full unique key that
 *      names union_id, club_id or pool_id and nothing finer than a time bucket
 *      or a category (BUCKET_COLUMNS), derived from the live catalog; plus the
 *      entity rows themselves (ENTITY_TABLES: unions, clubs, bbj_pools).
 *   3. VIOLATIONS. In a function on the path: an INSERT/UPDATE/DELETE of a
 *      shared table (unless the same function takes that table NOWAIT or SKIP
 *      LOCKED); a FOR UPDATE / FOR NO KEY UPDATE over a shared table without
 *      NOWAIT or SKIP LOCKED; a blocking exclusive advisory lock
 *      (pg_advisory_lock / pg_advisory_xact_lock, not _shared, not try_) keyed
 *      by a scope prefix ('bbj-pool:', 'insurance-bank:', 'union-accounting:',
 *      'union-wallet:', 'club-wallet:') or by a union/club/pool id alone.
 *      Shared locks, try-locks and NOWAIT are allowed.
 *
 * WHERE IT RUNS.
 *   - Live: public.fn_ca_hand_path_shared_writes() returns the same answer;
 *     scripts/ci/check-hand-path-shared-writes.mjs asks production and fails
 *     on any violation not in hand-path-shared-writes.allowlist.json.
 *   - In the applier: apply-recorded-migration.mjs splices a snapshot right
 *     after BEGIN; and a check right before the history row; a migration that
 *     ADDS a violation (present after, absent before, not declared) is
 *     refused inside its own transaction and nothing is installed. The query
 *     is inlined, so a migration cannot disarm the check by replacing
 *     fn_ca_hand_path_shared_writes().
 *
 * WHAT IT CANNOT SEE (read static text, conservative where it can be):
 *   - dynamic SQL (EXECUTE format(...)) and string-built table names;
 *   - whether a branch runs per hand: a write under IF is still reported (that
 *     is why pre-existing conditional ones are allowlisted with a reason);
 *   - triggers' WHEN clauses (a trigger is followed whenever its event and
 *     column list match).
 *   Callees are matched by name, so every overload of a name is followed.
 *
 * A migration that must add one (it never should) declares it, before BEGIN:
 *   -- @hand-path-shared-write-ok: <function> <write|row_lock|advisory_lock> <target> <why>
 */
import { pathToFileURL } from 'node:url';

/** Files from this version on carry the applier check. */
export const HAND_PATH_CHECKED_FROM = '20261118084747';

export const HAND_PATH_ROOTS = Object.freeze([
  'fn_ca_commit_hand_settlement',
  'fn_ca_commit_hand_submission',
  'fn_ca_process_hand_post_commit_obligations',
]);

/** Deferred bankers: shared rows off the hot path, try-lock / NOWAIT only. */
export const HAND_PATH_BANKERS = Object.freeze([
  'fn_ca_bank_pending_cash_rake',
  'fn_ca_bank_pending_hand_obligations',
]);

export const ENTITY_TABLES = Object.freeze(['unions', 'clubs', 'bbj_pools']);

/** Key columns no finer than a union/club/pool: time buckets and categories. */
export const BUCKET_COLUMNS = Object.freeze([
  'union_id',
  'club_id',
  'pool_id',
  'day',
  'stat_date',
  'acct_day',
  'week_start',
  'period_start',
  'period_end',
  'window_start',
  'hour_start',
  'year',
  'boundary',
  'kind',
  'wallet_key',
  'category',
  'transaction_type',
  'period',
  'asset',
  'currency',
]);

export const SCOPE_LOCK_PREFIXES = Object.freeze([
  'bbj-pool',
  'insurance-bank',
  'union-accounting',
  'union-wallet',
  'club-wallet',
]);

export const MAX_CALL_DEPTH = 12;
export const MAX_TRIGGER_HOPS = 2;

export const VIOLATION_KINDS = Object.freeze(['write', 'row_lock', 'advisory_lock']);

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `ARRAY[${xs.map(lit).join(',')}]::text[]`;
const NSPS = `ARRAY['public','smarter_private']::text[]`;
const WRITE_RE = `(insert\\s+into|delete\\s+from|update)\\s+(?:only\\s+)?(?:public\\.)?"?([a-z_][a-z0-9_]*)`;
const FROM_RE = `(?:from|join)\\s+(?:only\\s+)?(?:public\\.)?"?([a-z_][a-z0-9_]*)`;
// The same, with the alias that follows (FOR UPDATE OF <alias> locks only that relation).
const FROM_ALIAS_RE = `(?:from|join)\\s+(?:only\\s+)?(?:public\\.)?"?([a-z_][a-z0-9_]*)"?(?:\\s+(?:as\\s+)?([a-z_][a-z0-9_]*))?`;

/**
 * The columns an UPDATE (or an upsert's DO UPDATE) assigns: the SET targets,
 * as an SQL text[] expression over the statement text `stmt`. PostgreSQL fires
 * an UPDATE OF trigger only when one of its columns is a target of the SET
 * list ("A column-specific trigger ... will fire when any of its columns are
 * listed as targets in the UPDATE command's SET list"); a column named only in
 * the WHERE clause, a CASE, a RETURNING or a subquery never fires it. A target
 * is an identifier (optionally subscripted or a field of a composite) right
 * after SET or a comma and followed by "=" (not "=>", "=="). Conservative:
 * a comma-led "x =" elsewhere in the statement only adds a column, and the
 * multi-column form SET (a, b) = ... falls back to every word in the statement.
 */
const SET_TARGET_RE = `(?:\\mset\\M|,)\\s*"?([a-z_][a-z0-9_]*)"?(?:\\s*\\[[^]]*\\])?(?:\\.[a-z_][a-z0-9_]*)?\\s*=(?![=>])`;
const setTargets = (stmt) => `CASE WHEN ${stmt} ~ '\\mset\\M\\s*\\(' THEN pg_catalog.regexp_split_to_array(${stmt}, '[^a-z0-9_]+')
                     ELSE ARRAY(SELECT st[1] FROM pg_catalog.regexp_matches(${stmt}, '${SET_TARGET_RE}', 'g') st) END`;

/** Comment-blanked, lower-cased source (lit) and the same with string literals emptied (src). */
const normalized = (oids) => `
  SELECT p.oid, p.proname::text AS name, n.nspname::text AS nsp, l.lit,
         pg_catalog.regexp_replace(l.lit, '''[^'']*''', '''''', 'g') AS src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL (SELECT pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.lower(p.prosrc),
             '/\\*.*?\\*/', ' ', 'g'), '--[^\\n]*', ' ', 'g') AS lit) l
   WHERE p.oid = ANY (${oids}) AND p.prolang <> 12 AND p.prokind IN ('f', 'p')`;

/**
 * The analysis as a PL/pgSQL block: { declare, body }. The body leaves its
 * answer in the variable "a" (jsonb):
 *   { roots: [names found], closure: n, shared_tables: [...],
 *     violations: [{function, kind, target, path}] }
 * It walks the graph breadth-first over states (function, calls, trigger
 * hops), reading a function's edges once, the first time it is reached, so
 * only the reachable part of the catalog is parsed. `path` is one shortest
 * chain from a root ("a -> b =T=> c": -> a call, =T=> a trigger fired by a
 * write). Reads pg_catalog only: ACCESS SHARE on catalogs, no table read.
 */
export function handPathBlock() {
  const declare = `
 a jsonb;
 hp_front jsonb;
 hp_seen jsonb := '{}'::jsonb;
 hp_edges jsonb := '{}'::jsonb;
 hp_parent jsonb := '{}'::jsonb;
 hp_need oid[];
 hp_closure oid[];
 hp_level int := 0;
 hp_v jsonb;
 hp_path text;
 hp_cur text;
 hp_guard int;
 hp_out jsonb := '[]'::jsonb;`;
  const body = `
 SELECT COALESCE(jsonb_agg(jsonb_build_array(p.oid::text, 0, 0)), '[]'::jsonb),
        COALESCE(jsonb_object_agg(p.oid::text, jsonb_build_array(jsonb_build_array(0, 0))), '{}'::jsonb)
   INTO hp_front, hp_seen
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname::text = ANY (${arr(HAND_PATH_ROOTS)}) AND p.prokind IN ('f', 'p');
 WHILE jsonb_array_length(hp_front) > 0 AND hp_level < ${MAX_CALL_DEPTH + MAX_TRIGGER_HOPS + 2} LOOP
  hp_level := hp_level + 1;
  SELECT array_agg(DISTINCT (e->>0)::oid) INTO hp_need
    FROM jsonb_array_elements(hp_front) e WHERE NOT hp_edges ? (e->>0);
  IF hp_need IS NOT NULL THEN
   WITH f AS MATERIALIZED (${normalized('hp_need')}),
   calls AS (
    SELECT DISTINCT f.oid AS caller, g.oid AS callee, 'call'::text AS via
      FROM f
      CROSS JOIN LATERAL (SELECT DISTINCT (pg_catalog.regexp_matches(f.src, '([a-z_][a-z0-9_]*)\\s*\\(', 'g'))[1] AS nm) x
      JOIN pg_catalog.pg_proc g ON g.proname = x.nm::name
      JOIN pg_catalog.pg_namespace gn ON gn.oid = g.pronamespace AND gn.nspname::text = ANY (${NSPS})
     WHERE g.oid <> f.oid AND g.prokind IN ('f', 'p') AND g.prolang <> 12
       AND g.proname::text <> ALL (${arr(HAND_PATH_BANKERS)})
   ),
   writes AS MATERIALIZED (
    SELECT f.oid, m[1] AS op, m[2] AS tbl, s.stmt
      FROM f
      CROSS JOIN LATERAL pg_catalog.regexp_split_to_table(f.src, ';') s(stmt)
      CROSS JOIN LATERAL pg_catalog.regexp_matches(s.stmt, '${WRITE_RE}', 'g') m
     WHERE f.src ~ '(?:insert\\s+into|delete\\s+from|update)\\s'
   ),
   trigs AS (
    SELECT DISTINCT w.oid AS caller, t.tgfoid AS callee, 'trigger'::text AS via
      FROM writes w
      JOIN pg_catalog.pg_class r ON r.relname = w.tbl::name AND r.relnamespace = 'public'::regnamespace
      JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal AND t.tgenabled <> 'D'
      JOIN pg_catalog.pg_proc tp ON tp.oid = t.tgfoid
     WHERE tp.proname::text <> ALL (${arr(HAND_PATH_BANKERS)})
       AND ((w.op LIKE 'insert%' AND t.tgtype & 4 <> 0)
         OR (w.op LIKE 'delete%' AND t.tgtype & 8 <> 0)
         OR ((w.op = 'update' OR (w.op LIKE 'insert%' AND w.stmt ~ 'on\\s+conflict[^;]*do\\s+update'))
             AND t.tgtype & 16 <> 0
             AND (pg_catalog.cardinality(t.tgattr::int2[]) = 0
                  OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute pa
                              WHERE pa.attrelid = r.oid AND pa.attnum = ANY (t.tgattr::int2[])
                                AND pa.attname::text = ANY (${setTargets('w.stmt')})))))
   ),
   e AS (SELECT * FROM calls UNION SELECT * FROM trigs)
   SELECT hp_edges
          || COALESCE((SELECT jsonb_object_agg(g.caller::text, g.es)
                         FROM (SELECT caller, jsonb_agg(jsonb_build_array(callee::text, via)) AS es
                                 FROM e GROUP BY caller) g), '{}'::jsonb)
     INTO hp_edges;
   SELECT hp_edges || COALESCE(jsonb_object_agg(o::text, '[]'::jsonb), '{}'::jsonb) INTO hp_edges
     FROM unnest(hp_need) o WHERE NOT hp_edges ? o::text;
  END IF;
  WITH nxt AS (
   SELECT DISTINCT ed->>0 AS o,
          (e->>1)::int + (ed->>1 = 'call')::int AS c,
          (e->>2)::int + (ed->>1 = 'trigger')::int AS t,
          e->>0 AS parent, ed->>1 AS via
     FROM jsonb_array_elements(hp_front) e
     CROSS JOIN LATERAL jsonb_array_elements(hp_edges->(e->>0)) ed
  ), fresh AS (
   SELECT * FROM nxt n
    WHERE n.c <= ${MAX_CALL_DEPTH} AND n.t <= ${MAX_TRIGGER_HOPS}
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(hp_seen->n.o, '[]'::jsonb)) s
                       WHERE (s->>0)::int <= n.c AND (s->>1)::int <= n.t)
  ), kept AS (
   SELECT DISTINCT ON (x.o, x.c, x.t) x.* FROM fresh x
    WHERE NOT EXISTS (SELECT 1 FROM fresh y WHERE y.o = x.o AND y.c <= x.c AND y.t <= x.t
                                             AND (y.c < x.c OR y.t < x.t))
    ORDER BY x.o, x.c, x.t, x.via, x.parent
  ), firsts AS (
   SELECT DISTINCT ON (k.o) k.o, k.parent, k.via FROM kept k
    WHERE NOT hp_seen ? k.o ORDER BY k.o, k.c + k.t, k.via, k.parent
  )
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_array(k.o, k.c, k.t)) FROM kept k), '[]'::jsonb),
         hp_seen || COALESCE((SELECT jsonb_object_agg(g.o, COALESCE(hp_seen->g.o, '[]'::jsonb) || g.pairs)
                                FROM (SELECT k.o, jsonb_agg(jsonb_build_array(k.c, k.t)) AS pairs
                                        FROM kept k GROUP BY k.o) g), '{}'::jsonb),
         hp_parent || COALESCE((SELECT jsonb_object_agg(f.o, jsonb_build_array(f.parent, f.via)) FROM firsts f),
                               '{}'::jsonb)
    INTO hp_front, hp_seen, hp_parent;
 END LOOP;
 SELECT array_agg(k::oid) INTO hp_closure FROM jsonb_object_keys(hp_seen) k;
 WITH f AS MATERIALIZED (${normalized('hp_closure')}),
 shared AS MATERIALIZED (
  SELECT c.relname::text AS tbl
    FROM pg_catalog.pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND (c.relname::text = ANY (${arr(ENTITY_TABLES)})
          OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_index i
            CROSS JOIN LATERAL (SELECT array_agg(a.attname::text) AS cols FROM pg_catalog.pg_attribute a
                                 WHERE a.attrelid = c.oid AND a.attnum = ANY (i.indkey::int2[])) k
            WHERE i.indrelid = c.oid AND i.indisunique AND i.indpred IS NULL AND NOT (0 = ANY (i.indkey::int2[]))
              AND k.cols && ARRAY['union_id', 'club_id', 'pool_id']::text[]
              AND k.cols <@ ${arr(BUCKET_COLUMNS)}))
 ),
 stmts AS MATERIALIZED (
  SELECT f.oid, f.name, s.stmt FROM f CROSS JOIN LATERAL pg_catalog.regexp_split_to_table(f.src, ';') s(stmt)
 ),
 nowait AS MATERIALIZED (
  SELECT DISTINCT st.oid, m[1] AS tbl FROM stmts st
   CROSS JOIN LATERAL pg_catalog.regexp_matches(st.stmt, '${FROM_RE}', 'g') m
   WHERE st.stmt ~ '(?:nowait|skip\\s+locked)'
 ),
 litstmts AS MATERIALIZED (
  SELECT f.oid, f.name, s.stmt FROM f CROSS JOIN LATERAL pg_catalog.regexp_split_to_table(f.lit, ';') s(stmt)
   WHERE f.lit ~ 'pg_advisory(?:_xact)?_lock\\s*\\('
 ),
 found AS (
  SELECT st.oid, st.name, 'write'::text AS kind, m[2] AS target FROM stmts st
   CROSS JOIN LATERAL pg_catalog.regexp_matches(st.stmt, '${WRITE_RE}', 'g') m
   WHERE m[2] IN (SELECT tbl FROM shared)
     AND NOT EXISTS (SELECT 1 FROM nowait nw WHERE nw.oid = st.oid AND nw.tbl = m[2])
  UNION
  SELECT st.oid, st.name, 'row_lock', m[1] FROM stmts st
   CROSS JOIN LATERAL pg_catalog.regexp_matches(st.stmt, '${FROM_ALIAS_RE}', 'g') m
   CROSS JOIN LATERAL (SELECT pg_catalog.regexp_split_to_array(pg_catalog.btrim(substring(st.stmt
            FROM 'for\\s+(?:no\\s+key\\s+)?update\\s+of\\s+([a-z0-9_]+(?:\\s*,\\s*[a-z0-9_]+)*)')), '\\s*,\\s*') AS ofs) o
   WHERE st.stmt ~ 'for\\s+(?:no\\s+key\\s+)?update' AND st.stmt !~ '(?:nowait|skip\\s+locked)'
     AND m[1] IN (SELECT tbl FROM shared)
     AND (o.ofs IS NULL OR m[1] = ANY (o.ofs) OR m[2] = ANY (o.ofs))
  UNION
  SELECT st.oid, st.name, 'advisory_lock', COALESCE(substring(st.stmt FROM '''([a-z][a-z0-9_-]*:)'), 'scope id')
    FROM litstmts st
   WHERE st.stmt ~ 'pg_advisory(?:_xact)?_lock\\s*\\('
     AND (st.stmt ~ '''(?:${SCOPE_LOCK_PREFIXES.join('|')}):'
          OR (st.stmt ~ '(?:union|club|pool)_?id\\M'
              AND st.stmt !~ '(?:user|player|hand|table|tournament|seat|agent|horse|actor|member|ticket|entry|operation)'))
 )
 SELECT jsonb_build_object(
   'roots', COALESCE((SELECT jsonb_agg(DISTINCT p.proname::text) FROM pg_catalog.pg_proc p
                       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname::text = ANY (${arr(HAND_PATH_ROOTS)})), '[]'::jsonb),
   'closure', COALESCE(pg_catalog.cardinality(hp_closure), 0),
   'shared_tables', COALESCE((SELECT jsonb_agg(sh.tbl ORDER BY sh.tbl) FROM shared sh), '[]'::jsonb),
   'violations', COALESCE((SELECT jsonb_agg(jsonb_build_object('function', x.name, 'kind', x.kind,
                                    'target', x.target, 'oid', x.oid::text))
                             FROM (SELECT DISTINCT ON (name, kind, target) * FROM found
                                    ORDER BY name, kind, target, oid) x), '[]'::jsonb))
   INTO a;
 FOR hp_v IN SELECT * FROM jsonb_array_elements(a->'violations') LOOP
  hp_cur := hp_v->>'oid';
  hp_path := hp_v->>'function';
  hp_guard := 0;
  WHILE hp_parent ? hp_cur AND hp_guard < 64 LOOP
   hp_path := (SELECT p.proname::text FROM pg_catalog.pg_proc p WHERE p.oid = (hp_parent->hp_cur->>0)::oid)
              || CASE WHEN hp_parent->hp_cur->>1 = 'trigger' THEN ' =T=> ' ELSE ' -> ' END || hp_path;
   hp_cur := hp_parent->hp_cur->>0;
   hp_guard := hp_guard + 1;
  END LOOP;
  hp_out := hp_out || jsonb_build_array((hp_v - 'oid') || jsonb_build_object('path', hp_path));
 END LOOP;
 a := jsonb_set(a, '{violations}', COALESCE((SELECT jsonb_agg(v ORDER BY v->>'function', v->>'kind', v->>'target')
                                              FROM jsonb_array_elements(hp_out) v), '[]'::jsonb));`;
  return { declare, body };
}

/** CREATE OR REPLACE for the live reader: the same block, returned. */
export function handPathFunctionSQL() {
  const { declare, body } = handPathBlock();
  return `CREATE OR REPLACE FUNCTION public.fn_ca_hand_path_shared_writes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $hand_path$
DECLARE${declare}
BEGIN${body}
 RETURN a;
END
$hand_path$`;
}

/** A read-only probe (DO block + SELECT) for running the block by hand. */
export function handPathProbeSQL() {
  const { declare, body } = handPathBlock();
  return `DO $probe$
DECLARE${declare}
BEGIN
 PERFORM pg_catalog.set_config('search_path', 'pg_catalog', true);${body}
 PERFORM pg_catalog.set_config('ca.hand_path_probe', a::text, false);
END $probe$;
SELECT pg_catalog.current_setting('ca.hand_path_probe')::jsonb AS answer;
`;
}

/** The identity of a violation: function | kind | target. */
export const violationKey = (v) => `${v.function}|${v.kind}|${v.target}`;

/**
 * Compare a live answer with the allowlist. Returns null when the answer
 * cannot be judged (10.86: "I could not tell" is its own outcome).
 */
export function judge(answer, allowlist) {
  if (!answer || typeof answer !== 'object' || !Array.isArray(answer.violations)) return null;
  const roots = Array.isArray(answer.roots) ? answer.roots : [];
  const missingRoots = HAND_PATH_ROOTS.filter((r) => !roots.includes(r));
  if (missingRoots.length) return { unknown: `hand doors not found: ${missingRoots.join(', ')}` };
  const allowed = new Map((allowlist?.entries ?? []).map((e) => [violationKey(e), e]));
  const found = new Map(answer.violations.map((v) => [violationKey(v), v]));
  return {
    unexpected: [...found.values()].filter((v) => !allowed.has(violationKey(v))),
    allowed: [...found.values()].filter((v) => allowed.has(violationKey(v))),
    stale: [...allowed.values()].filter((e) => !found.has(violationKey(e))),
  };
}

const ENTRY_FIELDS = ['function', 'kind', 'target', 'owner', 'reason', 'date'];

/** Every allowlist entry names what, who, why and when. Returns problems. */
export function allowlistProblems(allowlist) {
  const problems = [];
  if (!allowlist || !Array.isArray(allowlist.entries)) return ['allowlist has no entries array'];
  const seen = new Set();
  for (const [i, e] of allowlist.entries.entries()) {
    for (const f of ENTRY_FIELDS)
      if (typeof e[f] !== 'string' || !e[f].trim()) problems.push(`entry ${i}: ${f} missing`);
    if (e.kind && !VIOLATION_KINDS.includes(e.kind)) problems.push(`entry ${i}: unknown kind ${e.kind}`);
    if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) problems.push(`entry ${i}: date not YYYY-MM-DD`);
    if (e.reason && e.reason.trim().length < 40) problems.push(`entry ${i}: reason too short to be a reason`);
    const k = violationKey(e);
    if (seen.has(k)) problems.push(`entry ${i}: duplicate ${k}`);
    seen.add(k);
  }
  return problems;
}

// ── the applier half ─────────────────────────────────────────────────────

export const isHandPathChecked = (file) => {
  const m = /(?:^|\/)(\d{14})_[^/]+\.sql$/.exec(file);
  return Boolean(m) && m[1] >= HAND_PATH_CHECKED_FROM;
};

/**
 * Only a migration that can change the graph is measured (twice, ~2 s each on
 * production): one that creates, replaces, alters or drops a function,
 * procedure, trigger, table or index, or runs dynamic SQL (EXECUTE), or
 * enables/disables a trigger. A data-only file pays nothing.
 */
export function canChangeHandPath(sql) {
  const s = String(sql);
  return (
    /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:constraint\s+)?(?:function|procedure|trigger|index|table)\b/i.test(
      s
    ) || /\bexecute\b/i.test(s)
  );
}

/** Violations a migration declares it adds, one per line, before BEGIN. */
export function declaredHandPathWrites(sql) {
  return [
    ...String(sql).matchAll(
      /^--\s*@hand-path-shared-write-ok:\s*([a-z_][a-z0-9_]*)\s+(write|row_lock|advisory_lock)\s+(\S+)\s+\S/gm
    ),
  ].map((m) => `${m[1]}|${m[2]}|${m[3]}`);
}

const SNAPSHOT_TAG = '$ca_hand_path_snapshot$';
const CHECK_TAG = '$ca_hand_path_check$';

/**
 * Sound catalog fingerprint over every pg_catalog input handPathBlock() reads
 * for a given reachable closure and identifier watch-set:
 *   1. pg_proc rows in public/smarter_private whose oid is in hp_closure OR
 *      whose proname is in HAND_PATH_ROOTS U callees(hp_closure);
 *   2. every non-internal trigger on public relations, its target table name,
 *      UPDATE OF column names, enabled state, and trigger function source;
 *   3. every public table/partitioned table and its unique non-partial indexes
 *      with resolved key column names.
 * If this single indexed md5 is unchanged between snapshot and check, then
 * handPathBlock() is mathematically guaranteed to produce the exact same
 * roots, closure, shared tables and violations, so checkSQL() can skip the
 * second ~2 s full regex BFS (reclaiming ~2 s of the 12 s ordinary budget).
 */
function catalogFingerprintSQL(closureExpr, watchNamesExpr) {
  return `pg_catalog.md5(
   COALESCE((
    SELECT pg_catalog.string_agg(
      p.oid::text || ':' || p.pronamespace::text || ':' || p.proname::text || ':' ||
      p.prokind::text || ':' || p.prolang::text || ':' || pg_catalog.md5(COALESCE(p.prosrc, '')),
      '|' ORDER BY p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname::text = ANY (${NSPS})
       AND (p.oid = ANY (${closureExpr}) OR p.proname::text = ANY (${watchNamesExpr}))
   ), '')
   || '#' ||
   COALESCE((
    SELECT pg_catalog.string_agg(
      t.oid::text || ':' || t.tgrelid::text || ':' || r.relname::text || ':' ||
      t.tgfoid::text || ':' || t.tgtype::text || ':' || t.tgenabled::text || ':' ||
      COALESCE(t.tgattr::text, '') || ':' ||
      COALESCE((
        SELECT pg_catalog.string_agg(pa.attnum::text || '=' || pa.attname::text, ',' ORDER BY pa.attnum)
          FROM pg_catalog.pg_attribute pa
         WHERE pa.attrelid = r.oid AND pa.attnum = ANY (t.tgattr::int2[])
      ), '') || ':' ||
      COALESCE(tp.proname::text, '') || ':' || pg_catalog.md5(COALESCE(tp.prosrc, '')),
      '|' ORDER BY t.oid)
      FROM pg_catalog.pg_class r
      JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
      LEFT JOIN pg_catalog.pg_proc tp ON tp.oid = t.tgfoid
     WHERE r.relnamespace = 'public'::regnamespace
   ), '')
   || '#' ||
   COALESCE((
    SELECT pg_catalog.string_agg(
      c.oid::text || ':' || c.relname::text || ':' || c.relkind::text || ':' ||
      COALESCE(i.indexrelid::text, '') || ':' || COALESCE(i.indkey::text, '') || ':' ||
      COALESCE((
        SELECT pg_catalog.string_agg(pa.attnum::text || '=' || pa.attname::text, ',' ORDER BY pa.attnum)
          FROM pg_catalog.pg_attribute pa
         WHERE pa.attrelid = c.oid AND pa.attnum = ANY (i.indkey::int2[])
      ), ''),
      '|' ORDER BY c.oid, i.indexrelid NULLS FIRST)
      FROM pg_catalog.pg_class c
      LEFT JOIN pg_catalog.pg_index i
        ON i.indrelid = c.oid AND i.indisunique AND i.indpred IS NULL
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
   ), '')
  )`;
}

function snapshotSQL() {
  const { declare, body } = handPathBlock();
  return `
DO ${SNAPSHOT_TAG}
DECLARE previous text := current_setting('search_path'); hp_watch_names text[]; hp_fp_before text;${declare}
BEGIN
 PERFORM set_config('search_path', 'pg_catalog', true);${body}
 hp_closure := COALESCE(hp_closure, ARRAY[]::oid[]);
 SELECT COALESCE(array_agg(DISTINCT w.nm), ${arr(HAND_PATH_ROOTS)}) INTO hp_watch_names
   FROM (
     SELECT unnest(${arr(HAND_PATH_ROOTS)}) AS nm
     UNION
     SELECT (pg_catalog.regexp_matches(f.src, '([a-z_][a-z0-9_]*)\\s*\\(', 'g'))[1] AS nm
       FROM (${normalized('hp_closure')}) f
   ) w;
 hp_fp_before := ${catalogFingerprintSQL('hp_closure', 'hp_watch_names')};
 PERFORM pg_catalog.set_config('search_path', previous, true);
 PERFORM pg_catalog.set_config('ca.hand_path_before', (
   SELECT COALESCE(jsonb_agg(v->>'function' || '|' || (v->>'kind') || '|' || (v->>'target')), '[]'::jsonb)::text
     FROM jsonb_array_elements(a->'violations') v), true);
 PERFORM pg_catalog.set_config('ca.hand_path_roots_before', (a->'roots')::text, true);
 PERFORM pg_catalog.set_config('ca.hand_path_closure_before', hp_closure::text, true);
 PERFORM pg_catalog.set_config('ca.hand_path_watch_names_before', hp_watch_names::text, true);
 PERFORM pg_catalog.set_config('ca.hand_path_catalog_fp', hp_fp_before, true);
END ${SNAPSHOT_TAG};`;
}

function checkSQL(declared) {
  const { declare, body } = handPathBlock();
  return `
DO ${CHECK_TAG}
DECLARE previous text := current_setting('search_path'); added text; missing text; hp_fp_before text; hp_fp_after text; hp_closure_before oid[]; hp_watch_before text[];${declare}
BEGIN
 PERFORM set_config('search_path', 'pg_catalog', true);
 hp_fp_before := pg_catalog.current_setting('ca.hand_path_catalog_fp', true);
 IF hp_fp_before IS NOT NULL AND hp_fp_before <> '' THEN
  hp_closure_before := pg_catalog.current_setting('ca.hand_path_closure_before')::oid[];
  hp_watch_before := pg_catalog.current_setting('ca.hand_path_watch_names_before')::text[];
  hp_fp_after := ${catalogFingerprintSQL('hp_closure_before', 'hp_watch_before')};
  IF hp_fp_after IS NOT NULL AND hp_fp_after = hp_fp_before THEN
   PERFORM pg_catalog.set_config('ca.hand_path_check_mode', 'fast_path', true);
   PERFORM pg_catalog.set_config('search_path', previous, true);
   RETURN;
  END IF;
 END IF;
 PERFORM pg_catalog.set_config('ca.hand_path_check_mode', 'full_bfs', true);${body}
 PERFORM pg_catalog.set_config('search_path', previous, true);
 SELECT string_agg(r, ', ') INTO missing
   FROM jsonb_array_elements_text(current_setting('ca.hand_path_roots_before')::jsonb) r
  WHERE NOT (a->'roots') ? r;
 IF missing IS NOT NULL THEN
  RAISE EXCEPTION 'hand_path_door_missing: %', missing USING ERRCODE = '55000',
   HINT = 'A hand door was dropped or renamed: name its successor in scripts/ci/hand-path-shared-writes.mjs HAND_PATH_ROOTS.';
 END IF;
 SELECT string_agg((v->>'function') || ' ' || (v->>'kind') || ' ' || (v->>'target') || ' via ' || COALESCE(v->>'path', '?'), '; ')
   INTO added
   FROM jsonb_array_elements(a->'violations') v
  WHERE (v->>'function' || '|' || (v->>'kind') || '|' || (v->>'target'))
        <> ALL (ARRAY(SELECT jsonb_array_elements_text(current_setting('ca.hand_path_before')::jsonb)))
    AND (v->>'function' || '|' || (v->>'kind') || '|' || (v->>'target')) <> ALL (${arr(declared)});
 IF added IS NOT NULL THEN
  RAISE EXCEPTION 'migration_adds_a_shared_write_to_the_hand_path: %', added USING ERRCODE = '55000',
   HINT = 'A hand''s money path must never wait on a union/club-wide row. Store the obligation in a per-hand row and bank it off the hot path with NOWAIT/try-lock (see fn_ca_bank_pending_cash_rake), or declare -- @hand-path-shared-write-ok: <function> <kind> <target> <why>.';
 END IF;
END ${CHECK_TAG};`;
}

/**
 * The two pieces the applier splices into a migration's own transaction:
 * the snapshot (right after BEGIN;) and the check (right before the history
 * row and COMMIT;). Both '' when the file is older than the cutover or cannot
 * change the graph.
 */
export function handPathParts(file, source, body) {
  if (!isHandPathChecked(file) || !canChangeHandPath(source)) return { snapshot: '', check: '' };
  if (!/^[ \t]*BEGIN[ \t]*;/im.test(body) || !/COMMIT\s*;\s*$/i.test(body))
    throw new Error('hand-path guard requires one BEGIN; ... COMMIT; transaction');
  if (body.includes(SNAPSHOT_TAG) || body.includes(CHECK_TAG))
    throw new Error('migration conflicts with the reserved hand-path delimiters');
  return { snapshot: '\n' + snapshotSQL(), check: checkSQL(declaredHandPathWrites(source)) + '\n' };
}

/** Wrap a migration's atomic SQL exactly as the applier does. */
export function handPathGuardSQL(file, source, atomicSQL) {
  const { snapshot, check } = handPathParts(file, source, atomicSQL);
  if (!snapshot) return atomicSQL;
  return atomicSQL
    .replace(/COMMIT\s*;\s*$/i, () => check + 'COMMIT;')
    .replace(/^([ \t]*BEGIN[ \t]*;)/im, (b) => b + snapshot);
}

// CLI: print the live reader or a read-only probe.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--print-function') process.stdout.write(handPathFunctionSQL() + ';\n');
  else if (process.argv[2] === '--print-probe') process.stdout.write(handPathProbeSQL());
}
