BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH boundary AS (
  SELECT t.announced_at,b.break_started_at, b.break_ended_at AS thaw, b.tables_resumed,
         l.acquired_at AS leader_at, l.heartbeat_at
    FROM public.engine_maintenance_break_log b
    JOIN public.engine_maintenance_thaws t ON t.freeze_started_at = b.break_started_at
      AND t.thawed_by = b.engine_version
    JOIN public.engine_leader l ON l.id AND l.instance_id = :'instance'
      AND l.engine_version = left(:'target',8)
   WHERE b.engine_version = l.engine_version AND b.thaw_ok
     AND (nullif(:'started','') IS NULL OR b.break_started_at = nullif(:'started','')::timestamptz)
     AND (nullif(:'announced','') IS NULL OR t.announced_at = nullif(:'announced','')::timestamptz)
     AND :'container_started'::timestamptz BETWEEN b.break_started_at AND b.break_ended_at
     AND l.acquired_at BETWEEN b.break_started_at AND b.break_ended_at
     AND l.heartbeat_at BETWEEN now() - interval '30 seconds' AND now() + interval '5 seconds'
), first_hands AS (
  SELECT min(h.created_at) FILTER (WHERE h.tournament_id IS NULL AND t.dealing_halted_reason IS DISTINCT FROM 'lightning') AS first_cash,
         min(h.created_at) FILTER (WHERE h.tournament_id IS NOT NULL) AS first_tournament,
         min(h.created_at) FILTER (WHERE t.dealing_halted_reason='lightning') AS first_lightning
    FROM boundary b JOIN public.hand_history h ON h.created_at BETWEEN b.thaw AND b.thaw + interval '5 minutes'
    JOIN public.tables t ON t.id=h.table_id
), census AS (
  SELECT t.id, coalesce(e.tournament_type,'CASH') AS kind, h.created_at AS last_hand,
         CASE WHEN e.on_break AND e.break_ends_at > now() THEN 'tournament break'
              WHEN e.addon_period_ends_at > now() THEN 'add-on'
              WHEN s.ready < CASE WHEN e.id IS NULL THEN greatest(2,coalesce(t.auto_start_players,2)) ELSE 2 END THEN 'underfilled'
              WHEN h.created_at >= b.thaw THEN 'advanced'
              ELSE 'awaiting post-thaw hand' END AS evidence
    FROM boundary b JOIN public.tables t ON t.status = 'running' AND NOT coalesce(t.is_deleted,false)
    LEFT JOIN public.tournaments e ON e.id = t.tournament_id
    LEFT JOIN LATERAL (SELECT count(*) AS ready FROM public.table_seats WHERE table_id=t.id AND left_at IS NULL
        AND stack>0 AND (e.id IS NOT NULL OR (NOT coalesce(is_sitting_out,false) AND NOT coalesce(is_away,false)))) s ON true
    LEFT JOIN LATERAL (SELECT created_at FROM public.hand_history WHERE table_id=t.id ORDER BY created_at DESC LIMIT 1) h ON true
   WHERE t.dealing_halted_reason IS DISTINCT FROM 'lightning' AND (t.tournament_id IS NULL OR e.status IN ('RUNNING','COMPLETING'))
     AND now() BETWEEN b.thaw AND b.thaw + interval '10 minutes'
), groups AS (
  SELECT kind,evidence,count(*) AS tables, array_agg(id ORDER BY id) FILTER (WHERE evidence='awaiting post-thaw hand') AS unresolved
    FROM census GROUP BY kind,evidence
), lightning AS (
  SELECT c.cluster_id,h.formed_at,h.settled_at,h.hand_number
    FROM boundary b CROSS JOIN (SELECT DISTINCT cluster_id FROM public.lightning_pool_slot WHERE closed_at IS NULL) c
    LEFT JOIN LATERAL (SELECT formed_at,settled_at,hand_number FROM public.lightning_hand
      WHERE cluster_id=c.cluster_id AND formed_at>=b.thaw AND settled_at IS NOT NULL ORDER BY formed_at DESC LIMIT 1) h ON true
   WHERE now() BETWEEN b.thaw AND b.thaw + interval '10 minutes'
)
SELECT jsonb_build_object('runId',:'run_id','targetSha',:'target','instanceId',:'instance','observedAt',now(),
  'announcedAt',b.announced_at,'breakStartedAt',b.break_started_at,'leaderAt',b.leader_at,
  'thawAt',b.thaw,'secondsSinceThaw',extract(epoch from now()-b.thaw),'tablesResumed',b.tables_resumed,'firstClassicCashHandAt',f.first_cash,'firstLightningHandAt',f.first_lightning,'firstTournamentHandAt',f.first_tournament,
  'censusInObservationWindow',now() BETWEEN b.thaw AND b.thaw + interval '10 minutes',
  'tables',(SELECT jsonb_agg(to_jsonb(g) ORDER BY kind,evidence) FROM groups g),
  'lightning',(SELECT jsonb_agg(to_jsonb(l) ORDER BY cluster_id) FROM lightning l)) AS receipt
FROM boundary b CROSS JOIN first_hands f
\gset
\echo :receipt
COMMIT;
