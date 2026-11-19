-- 20261118155729_an_update_of_trigger_fires_on_a_set_target_never_a_where_col.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN UPDATE OF TRIGGER FIRES ON A SET TARGET, NEVER ON A WHERE COLUMN
-- (incident 075013fd, lane H2)
--
-- public.fn_ca_hand_path_shared_writes() (20261118084747) followed an
-- UPDATE OF <col> trigger whenever <col> appeared ANYWHERE in the statement,
-- WHERE clause included. PostgreSQL fires a column trigger only when one of
-- its columns is a TARGET of the UPDATE's SET list (CREATE TRIGGER: "mentioned
-- as a target of the UPDATE command"), so the reader walked edges that cannot
-- fire and reported shared writes that no hand reaches:
--
--   fn_ca_commit_hand_settlement_before_lease_generation:
--     UPDATE tournament_players SET chips, table_id, seat_number
--      WHERE ... AND tp.status = 'playing'
--   -> trg_sync_tournament_current_players (UPDATE OF status, tournament_id):
--      cannot fire; and even when it does, fn_sync_tournament_current_players
--      SETs only tournaments.current_players, so
--   -> zz_ca_fund_overlay_on_lock / trg_tournaments_start_readiness
--      (BEFORE UPDATE OF status ON tournaments): cannot fire either.
--   fn_ca_commit_hand_settlement (time bank):
--     UPDATE table_seats SET time_bank_* WHERE ... s.left_at IS NULL
--   -> trg_seat_change_syncs_seat_first_count (UPDATE OF left_at): cannot fire.
--
-- Measured read-only on production 2026-11-18 with the corrected rule: 746
-- functions on the path (875 before), 14 violations (23 before). Gone:
-- fn_ca_fund_overlay_on_lock x4, fn_guard_tournament_start_readiness x2
-- (a hand commit never transitions a tournament), and the seat-parent
-- entries fn_refresh_club_activity_counts, fn_sync_club_table_counts,
-- guard_member_club_standalone_game (a hand never changes its table's status).
--
-- The rule stays conservative: a target is an unqualified name followed by
-- "=" (SET targets cannot be table-qualified, so s.col = x is a comparison)
-- or a name inside SET (a, b) =; an unqualified "col = x" in a WHERE still
-- counts. The applier inlines the same block from
-- scripts/ci/hand-path-shared-writes.mjs, which this text is generated from
-- (handPathFunctionSQL) and pinned to by
-- tests/a-hands-money-path-never-writes-a-shared-row.law.test.ts.
--
-- Reads pg_catalog only, writes nothing, runs on no timer.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_hand_path_shared_writes()'::regprocedure)) = '40df4be83da242e93bbd2749665518db')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fn_ca_hand_path_shared_writes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $hand_path$
DECLARE
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
 hp_out jsonb := '[]'::jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_array(p.oid::text, 0, 0)), '[]'::jsonb),
        COALESCE(jsonb_object_agg(p.oid::text, jsonb_build_array(jsonb_build_array(0, 0))), '{}'::jsonb)
   INTO hp_front, hp_seen
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname::text = ANY (ARRAY['fn_ca_commit_hand_settlement','fn_ca_commit_hand_submission','fn_ca_process_hand_post_commit_obligations']::text[]) AND p.prokind IN ('f', 'p');
 WHILE jsonb_array_length(hp_front) > 0 AND hp_level < 16 LOOP
  hp_level := hp_level + 1;
  SELECT array_agg(DISTINCT (e->>0)::oid) INTO hp_need
    FROM jsonb_array_elements(hp_front) e WHERE NOT hp_edges ? (e->>0);
  IF hp_need IS NOT NULL THEN
   WITH f AS MATERIALIZED (
  SELECT p.oid, p.proname::text AS name, n.nspname::text AS nsp, l.lit,
         pg_catalog.regexp_replace(l.lit, '''[^'']*''', '''''', 'g') AS src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL (SELECT pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.lower(p.prosrc),
             '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g') AS lit) l
   WHERE p.oid = ANY (hp_need) AND p.prolang <> 12 AND p.prokind IN ('f', 'p')),
   calls AS (
    SELECT DISTINCT f.oid AS caller, g.oid AS callee, 'call'::text AS via
      FROM f
      CROSS JOIN LATERAL (SELECT DISTINCT (pg_catalog.regexp_matches(f.src, '([a-z_][a-z0-9_]*)\s*\(', 'g'))[1] AS nm) x
      JOIN pg_catalog.pg_proc g ON g.proname = x.nm::name
      JOIN pg_catalog.pg_namespace gn ON gn.oid = g.pronamespace AND gn.nspname::text = ANY (ARRAY['public','smarter_private']::text[])
     WHERE g.oid <> f.oid AND g.prokind IN ('f', 'p') AND g.prolang <> 12
       AND g.proname::text <> ALL (ARRAY['fn_ca_bank_pending_cash_rake','fn_ca_bank_pending_hand_obligations']::text[])
   ),
   writes AS MATERIALIZED (
    SELECT f.oid, m[1] AS op, m[2] AS tbl, s.stmt,
           ARRAY(SELECT (pg_catalog.regexp_matches(s.stmt, '(?:^|[^a-z0-9_."])"?([a-z_][a-z0-9_]*)"?\s*=', 'g'))[1]
                 UNION ALL
                 SELECT pg_catalog.regexp_split_to_table(r[1], '[^a-z0-9_]+')
                   FROM pg_catalog.regexp_matches(s.stmt, '\mset\s*\(([^()]*)\)\s*=', 'g') r) AS sets
      FROM f
      CROSS JOIN LATERAL pg_catalog.regexp_split_to_table(f.src, ';') s(stmt)
      CROSS JOIN LATERAL pg_catalog.regexp_matches(s.stmt, '(insert\s+into|delete\s+from|update)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)', 'g') m
     WHERE f.src ~ '(?:insert\s+into|delete\s+from|update)\s'
   ),
   trigs AS (
    SELECT DISTINCT w.oid AS caller, t.tgfoid AS callee, 'trigger'::text AS via
      FROM writes w
      JOIN pg_catalog.pg_class r ON r.relname = w.tbl::name AND r.relnamespace = 'public'::regnamespace
      JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal AND t.tgenabled <> 'D'
      JOIN pg_catalog.pg_proc tp ON tp.oid = t.tgfoid
     WHERE tp.proname::text <> ALL (ARRAY['fn_ca_bank_pending_cash_rake','fn_ca_bank_pending_hand_obligations']::text[])
       AND ((w.op LIKE 'insert%' AND t.tgtype & 4 <> 0)
         OR (w.op LIKE 'delete%' AND t.tgtype & 8 <> 0)
         OR ((w.op = 'update' OR (w.op LIKE 'insert%' AND w.stmt ~ 'on\s+conflict[^;]*do\s+update'))
             AND t.tgtype & 16 <> 0
             AND (pg_catalog.cardinality(t.tgattr::int2[]) = 0
                  OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute pa
                              WHERE pa.attrelid = r.oid AND pa.attnum = ANY (t.tgattr::int2[])
                                AND pa.attname::text = ANY (w.sets)))))
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
    WHERE n.c <= 12 AND n.t <= 2
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
 WITH f AS MATERIALIZED (
  SELECT p.oid, p.proname::text AS name, n.nspname::text AS nsp, l.lit,
         pg_catalog.regexp_replace(l.lit, '''[^'']*''', '''''', 'g') AS src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL (SELECT pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.lower(p.prosrc),
             '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g') AS lit) l
   WHERE p.oid = ANY (hp_closure) AND p.prolang <> 12 AND p.prokind IN ('f', 'p')),
 shared AS MATERIALIZED (
  SELECT c.relname::text AS tbl
    FROM pg_catalog.pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND (c.relname::text = ANY (ARRAY['unions','clubs','bbj_pools']::text[])
          OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_index i
            CROSS JOIN LATERAL (SELECT array_agg(a.attname::text) AS cols FROM pg_catalog.pg_attribute a
                                 WHERE a.attrelid = c.oid AND a.attnum = ANY (i.indkey::int2[])) k
            WHERE i.indrelid = c.oid AND i.indisunique AND i.indpred IS NULL AND NOT (0 = ANY (i.indkey::int2[]))
              AND k.cols && ARRAY['union_id', 'club_id', 'pool_id']::text[]
              AND k.cols <@ ARRAY['union_id','club_id','pool_id','day','stat_date','acct_day','week_start','period_start','period_end','window_start','hour_start','year','boundary','kind','wallet_key','category','transaction_type','period','asset','currency']::text[]))
 ),
 stmts AS MATERIALIZED (
  SELECT f.oid, f.name, s.stmt FROM f CROSS JOIN LATERAL pg_catalog.regexp_split_to_table(f.src, ';') s(stmt)
 ),
 nowait AS MATERIALIZED (
  SELECT DISTINCT st.oid, m[1] AS tbl FROM stmts st
   CROSS JOIN LATERAL pg_catalog.regexp_matches(st.stmt, '(?:from|join)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)', 'g') m
   WHERE st.stmt ~ '(?:nowait|skip\s+locked)'
 ),
 litstmts AS MATERIALIZED (
  SELECT f.oid, f.name, s.stmt FROM f CROSS JOIN LATERAL pg_catalog.regexp_split_to_table(f.lit, ';') s(stmt)
   WHERE f.lit ~ 'pg_advisory(?:_xact)?_lock\s*\('
 ),
 found AS (
  SELECT st.oid, st.name, 'write'::text AS kind, m[2] AS target FROM stmts st
   CROSS JOIN LATERAL pg_catalog.regexp_matches(st.stmt, '(insert\s+into|delete\s+from|update)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)', 'g') m
   WHERE m[2] IN (SELECT tbl FROM shared)
     AND NOT EXISTS (SELECT 1 FROM nowait nw WHERE nw.oid = st.oid AND nw.tbl = m[2])
  UNION
  SELECT st.oid, st.name, 'row_lock', m[1] FROM stmts st
   CROSS JOIN LATERAL pg_catalog.regexp_matches(st.stmt, '(?:from|join)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?', 'g') m
   CROSS JOIN LATERAL (SELECT pg_catalog.regexp_split_to_array(pg_catalog.btrim(substring(st.stmt
            FROM 'for\s+(?:no\s+key\s+)?update\s+of\s+([a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)*)')), '\s*,\s*') AS ofs) o
   WHERE st.stmt ~ 'for\s+(?:no\s+key\s+)?update' AND st.stmt !~ '(?:nowait|skip\s+locked)'
     AND m[1] IN (SELECT tbl FROM shared)
     AND (o.ofs IS NULL OR m[1] = ANY (o.ofs) OR m[2] = ANY (o.ofs))
  UNION
  SELECT st.oid, st.name, 'advisory_lock', COALESCE(substring(st.stmt FROM '''([a-z][a-z0-9_-]*:)'), 'scope id')
    FROM litstmts st
   WHERE st.stmt ~ 'pg_advisory(?:_xact)?_lock\s*\('
     AND (st.stmt ~ '''(?:bbj-pool|insurance-bank|union-accounting|union-wallet|club-wallet):'
          OR (st.stmt ~ '(?:union|club|pool)_?id\M'
              AND st.stmt !~ '(?:user|player|hand|table|tournament|seat|agent|horse|actor|member|ticket|entry|operation)'))
 )
 SELECT jsonb_build_object(
   'roots', COALESCE((SELECT jsonb_agg(DISTINCT p.proname::text) FROM pg_catalog.pg_proc p
                       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname::text = ANY (ARRAY['fn_ca_commit_hand_settlement','fn_ca_commit_hand_submission','fn_ca_process_hand_post_commit_obligations']::text[])), '[]'::jsonb),
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
                                              FROM jsonb_array_elements(hp_out) v), '[]'::jsonb));
 RETURN a;
END
$hand_path$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_path_shared_writes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_path_shared_writes() TO service_role;

COMMENT ON FUNCTION public.fn_ca_hand_path_shared_writes() IS
  'A hand''s money path never writes a shared row (incident 075013fd): the blocking exclusive writes, row locks and advisory locks on union/club/pool-wide rows reachable from the hand doors; an UPDATE OF trigger is followed only for a SET target. Read-only; asked by scripts/ci/check-hand-path-shared-writes.mjs.';

COMMIT;
