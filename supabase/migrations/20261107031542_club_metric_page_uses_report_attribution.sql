-- 20261107031542_club_metric_page_uses_report_attribution
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 03:15:42 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- Ranked games must use the same attributed game identities and signed amounts as the report.
-- Keep the original plan for ordinary clubs and Recent. Share all filter and cursor logic.
-- @live-proof: position('scoped_games AS MATERIALIZED' IN pg_get_functiondef('public.ca_club_game_page_core_20261006(uuid,date,date,text,text,text,text,jsonb,integer)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.ca_club_game_page_core_20261006(uuid,date,date,text,text,text,text,jsonb,integer)'::regprocedure);
  edit text[];
BEGIN
  IF position('v_attributed boolean;' IN definition) > 0 THEN
    RAISE EXCEPTION 'Club Data ranked page preimage changed (already installed)';
  END IF;
  FOREACH edit SLICE 1 IN ARRAY ARRAY[
    ARRAY[$before$  v_out jsonb;$before$,$after$  v_out jsonb;
  v_attributed boolean;$after$],
    ARRAY[$before$  EXECUTE $query$$before$,$after$  v_attributed := v_sort <> 'recent' AND (
    p_club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR EXISTS (
      SELECT 1 FROM public.ca_horse_club_assignments a
       WHERE a.club_id = ANY(public.fn_ca_club_data_clubs(p_club_id))
    )
  );
  EXECUTE $query$$after$],
    ARRAY[$before$raw_cash AS (
      SELECT c.table_id,SUM(c.rake) fee,SUM(c.net) winnings,SUM(c.hands)::bigint hands
        FROM (SELECT g.game_id AS table_id,g.fee AS rake,g.winnings AS net,0::bigint AS hands
                FROM public.ca_club_data_game_ct g
               WHERE g.kind='CASH' AND g.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND g.stat_date BETWEEN $2 AND $3
              UNION ALL
              SELECT h.table_id,0,0,h.hands
                FROM public.ca_club_data_hands_ct h
               WHERE h.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND h.stat_date BETWEEN $2 AND $3) c
       GROUP BY c.table_id
    $before$,$after$$query$ || CASE WHEN v_attributed THEN $scoped$scoped_games AS MATERIALIZED (
      SELECT d.kind,d.game_id,SUM(d.fee) fee,SUM(d.winnings) winnings
        FROM public.ca_stats_club_data_fact_ct d
       WHERE d.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND d.stat_date BETWEEN $2 AND $3
       GROUP BY d.kind,d.game_id
    ), raw_cash AS (
      SELECT c.game_id AS table_id,c.fee,c.winnings,coalesce(h.hands,0)::bigint hands
        FROM (
          SELECT game_id,fee,winnings FROM scoped_games WHERE kind='CASH'
          UNION ALL
          SELECT f.table_id,0,0 FROM felt f
           WHERE NOT EXISTS (SELECT 1 FROM scoped_games g WHERE g.kind='CASH' AND g.game_id=f.table_id)
        ) c
        LEFT JOIN (
          SELECT table_id,sum(hands) hands FROM public.ca_club_data_hands_ct
           WHERE club_id = ANY (public.fn_ca_club_data_clubs($1)) AND stat_date BETWEEN $2 AND $3
           GROUP BY table_id
        ) h ON h.table_id=c.game_id
    $scoped$ ELSE $raw$@original@$raw$ END || $query$$after$],
    ARRAY[$before$      SELECT d.game_id AS tournament_id,SUM(d.fee) fee,SUM(d.winnings) winnings
        FROM public.ca_club_data_game_ct d
       WHERE d.kind='TOURNAMENT' AND d.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND d.stat_date BETWEEN $2 AND $3
       GROUP BY d.game_id$before$,$after$$query$ || CASE WHEN v_attributed THEN $scoped$      SELECT game_id AS tournament_id,fee,winnings FROM scoped_games WHERE kind='TOURNAMENT'$scoped$ ELSE $raw$@original@$raw$ END || $query$$after$],
    ARRAY[$before$        LEFT JOIN LATERAL (
          SELECT SUM(d.fee) fee,SUM(d.winnings) winnings
            FROM public.ca_club_data_game_ct d
           WHERE v.kind<>'CASH' AND d.club_id = ANY (public.fn_ca_club_data_clubs($1)) AND d.game_id=v.id::uuid
             AND d.stat_date BETWEEN $2 AND $3
        ) f ON true$before$,$after$$query$ || CASE WHEN v_attributed THEN $scoped$        LEFT JOIN tournament_facts f ON v.kind<>'CASH' AND f.tournament_id=v.id::uuid$scoped$ ELSE $raw$@original@$raw$ END || $query$$after$]
  ] LOOP
    IF array_length(string_to_array(definition,edit[1]),1) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'Club Data ranked page preimage changed';
    END IF;
    definition := replace(definition,edit[1],replace(edit[2],'@original@',edit[1]));
  END LOOP;
  EXECUTE definition;
END;
$migration$;
COMMIT;
