CREATE OR REPLACE FUNCTION public.fn_union_integrity_sweep(p_union_id uuid DEFAULT 'fade0000-0000-0000-0000-000000000001'::uuid, p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := now() - make_interval(hours => GREATEST(p_hours,1));
  v_agent_flags jsonb := '[]'::jsonb;
  v_dump_flags jsonb := '[]'::jsonb;
  v_coseat_flags jsonb := '[]'::jsonb;
  v_total int := 0;
BEGIN
  IF p_union_id IS NULL THEN
    RAISE EXCEPTION 'union identity is required' USING ERRCODE='22004';
  END IF;
  IF NOT public.fn_caller_is_engine() AND (auth.uid() IS NULL OR ( NOT public.fn_is_union_overseer(p_union_id, auth.uid()))) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  WITH scope_clubs AS MATERIALIZED (
    SELECT uc.club_id FROM public.union_clubs uc WHERE uc.union_id=p_union_id
    UNION
    SELECT c.id FROM public.clubs c WHERE c.id=p_union_id AND c.is_union IS TRUE
  ),
  roster AS (
    SELECT DISTINCT m.agent_id, m.user_id AS player_id
      FROM public.club_members m
      JOIN scope_clubs sc ON sc.club_id=m.club_id
     WHERE m.agent_id IS NOT NULL
       -- AN AGENT ROSTER COUNTS NO HORSE (2026-10-09), as the co-seating
       -- signal below already reads it.
       AND NOT EXISTS (SELECT 1 FROM public.profiles hp
                        WHERE hp.id = m.user_id AND COALESCE(hp.is_horse, false))
  ),
  /* A SESSION IS COUNTED WHOLE (2026-11-12). The net used to read each
     wallet row by its own created_at, so a cash session or tournament that
     began just before the window brought its cashout or prize in without the
     buy-in that paid for it (row 377222: a 136.08 prize counted against no
     40.00 buy-in, 17 minutes outside the window). Rows of the previous 24
     hours are read as well, and a pre-window DEBIT counts only when the same
     player has a CREDIT in the window on the same table (cash) or tournament,
     and for cash only when no cashout at that table closed it before the
     window. Nothing else from before the window is counted. */
  scoped AS MATERIALIZED (
    SELECT r.agent_id, r.player_id, wt.type, wt.category, wt.amount, wt.created_at,
           wt.table_id, wt.related_entity_id
      FROM roster r
      JOIN wallet_transactions wt ON wt.user_id = r.player_id
                                 AND wt.created_at >= v_from - interval '24 hours'
     WHERE EXISTS (
       SELECT 1 FROM public.tables t WHERE t.id=wt.table_id
         AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))
        OR (wt.table_id IS NULL AND EXISTS (
          SELECT 1 FROM public.tournaments t WHERE t.id=wt.related_entity_id
            AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs)))))
  ),
  net AS (
    SELECT s.agent_id,
           SUM(CASE WHEN s.type='credit' AND s.category IN ('cashout','prize','bounty') THEN s.amount ELSE 0 END)
         - SUM(CASE WHEN s.type='debit'  AND s.category IN ('buyin','rebuy','addon','tournament_buyin') THEN s.amount ELSE 0 END) AS player_net,
           COUNT(DISTINCT s.player_id) AS players
      FROM scoped s
     WHERE s.created_at >= v_from
        OR (s.type = 'debit'
            AND EXISTS (SELECT 1 FROM scoped w
                         WHERE w.player_id = s.player_id AND w.type = 'credit'
                           AND w.created_at >= v_from
                           AND w.table_id IS NOT DISTINCT FROM s.table_id
                           AND (s.table_id IS NOT NULL OR w.related_entity_id = s.related_entity_id))
            AND (s.table_id IS NULL OR NOT EXISTS (
                  SELECT 1 FROM scoped c
                   WHERE c.player_id = s.player_id AND c.table_id = s.table_id
                     AND c.type = 'credit' AND c.category = 'cashout'
                     AND c.created_at > s.created_at AND c.created_at < v_from)))
     GROUP BY s.agent_id
  ),
  rake AS (
    SELECT r.agent_id,
           SUM(rr.rake_amount * (e.value::numeric) / NULLIF(c.total,0)) AS rake
      FROM rake_records rr
      CROSS JOIN LATERAL (SELECT SUM(t.value::numeric) AS total
                            FROM jsonb_each_text(rr.player_contributions) t(key,value)) c
      CROSS JOIN LATERAL jsonb_each_text(rr.player_contributions) e(key,value)
      JOIN roster r ON r.player_id = (e.key)::uuid
     WHERE rr.created_at >= v_from AND rr.player_contributions IS NOT NULL AND c.total > 0
       AND (
         EXISTS (SELECT 1 FROM public.tables t WHERE t.id=rr.table_id
           AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))
         OR (rr.table_id IS NULL AND EXISTS (
           SELECT 1 FROM public.tournaments t WHERE t.id=rr.tournament_id
             AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs)))))
         OR (rr.table_id IS NULL AND rr.tournament_id IS NULL
           AND rr.club_id IN (SELECT club_id FROM scope_clubs))
       )
     GROUP BY r.agent_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_user_id', f.agent_id, 'players', f.players,
           'player_net', round(f.player_net,2), 'rake_generated', round(COALESCE(f.rake,0),2),
           'win_to_rake_ratio', round(f.player_net / NULLIF(COALESCE(f.rake,0),0), 2))), '[]'::jsonb)
    INTO v_agent_flags
    FROM (SELECT n.agent_id, n.players, n.player_net, k.rake
            FROM net n LEFT JOIN rake k ON k.agent_id = n.agent_id
           WHERE n.player_net > 0
             AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)
          OFFSET 0) f
   -- A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000), measured only
   -- for an agent whose 24 h edge already holds (20261119121500): the fence
   -- keeps the planner from pushing the 7-day measure down onto every agent
   -- with a positive net before the rake join.
   WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, f.agent_id, 7);

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_dump_flags FROM (
    SELECT jsonb_build_object(
             'from_user', ct.from_user_id, 'to_user', ct.to_user_id,
             'transfers', count(*), 'total', round(sum(ct.amount),2)) AS x
      FROM chip_transactions ct
     WHERE ct.created_at >= v_from
       AND (EXISTS (SELECT 1 FROM public.union_clubs uc
              WHERE uc.union_id=p_union_id AND uc.club_id=ct.club_id)
         OR EXISTS (SELECT 1 FROM public.clubs c
              WHERE c.id=p_union_id AND c.is_union IS TRUE AND c.id=ct.club_id))
       AND public.fn_union_transfer_counts_as_dump(ct)
     GROUP BY ct.from_user_id, ct.to_user_id
    HAVING sum(ct.amount) > 0
  ) s;

  -- Co-seating, excluding horse-vs-horse (simulated players always co-seat).
  /* EVERY PAIR THIS COUNTS HAS A PLAYER WHO IS NOT A HORSE (2026-10-22), so
     the pairs are found from those players' seats, read through
     idx_table_seats_user, and their tablemates through idx_table_seats_table.
     It read every seat joined in the window (87,000 a day, all but a few
     dozen of them horses' seats, with no index on joined_at) and joined each
     one to its table: 41 s cold inside union-integrity-sweep. A seat whose
     player has no profile row cannot exist (fk_table_seats_user_id_profiles)
     and a seat with no player cannot pair. Same pairs, same counts, same
     order and limit. */
  SELECT COALESCE(jsonb_agg(y), '[]'::jsonb) INTO v_coseat_flags FROM (
    SELECT jsonb_build_object('player_a', pr.a, 'player_b', pr.b,
                              'shared_tables', count(DISTINCT pr.table_id)) AS y
      FROM (SELECT LEAST(h.user_id, o.user_id) AS a, GREATEST(h.user_id, o.user_id) AS b,
                   h.table_id
              FROM profiles hp
              CROSS JOIN LATERAL (
                SELECT ts.user_id, ts.table_id
                  FROM table_seats ts
                 WHERE ts.user_id = hp.id AND ts.joined_at >= v_from) h
              JOIN tables t ON t.id = h.table_id AND t.union_id = p_union_id
              JOIN table_seats o ON o.table_id = h.table_id AND o.user_id <> h.user_id
                                AND o.joined_at >= v_from
             WHERE NOT COALESCE(hp.is_horse, false)) pr
     GROUP BY pr.a, pr.b
    HAVING count(DISTINCT pr.table_id) >= 8
     ORDER BY count(DISTINCT pr.table_id) DESC
     LIMIT 20
  ) s2;

  v_total := jsonb_array_length(v_agent_flags)
           + jsonb_array_length(v_dump_flags)
           + jsonb_array_length(v_coseat_flags);

  IF v_total > 0 THEN
    -- Each union owns its incident window; serialize concurrent reporters.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'union_integrity_alert:' || p_union_id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM financial_alerts
                     WHERE source = 'fn_union_integrity_sweep'
                       AND context->>'union_id'=p_union_id::text
                       AND created_at > now() - interval '20 hours') THEN
    INSERT INTO financial_alerts (severity, source, message, context)
    VALUES ('warning', 'fn_union_integrity_sweep',
            'Union integrity sweep raised ' || v_total || ' signal(s) - review by agent',
            jsonb_build_object('union_id', p_union_id, 'window_hours', p_hours,
                               'agent_roster_winning', v_agent_flags,
                               'direct_chip_transfer', v_dump_flags,
                               'co_seating', v_coseat_flags));
    END IF;
  END IF;

  /* A MISFIRE CLOSES ON A RE-MEASUREMENT (20261118165323). An open sweep alert of
     this union whose only signals are direct chip transfers closes once its own
     window, read again through fn_union_transfer_counts_as_dump, holds no dump:
     every transfer it named was the sender's own cashout through the club's
     cashier or the agent credit route. An alert that also names a winning agent roster or a
     co-seating pair stays open: those are review items for a person. */
  UPDATE financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = 'verified: re-measured over its own window; none of its direct chip transfers is a player-to-player dump (each was the sender''s own cashout through the club cashier or the agent credit route)'
   WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved
     AND a.context->>'union_id' = p_union_id::text
     AND jsonb_array_length(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) = 0
     AND jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0
     AND NOT EXISTS (
       SELECT 1 FROM chip_transactions ct
        WHERE ct.created_at >= a.created_at - make_interval(hours => GREATEST(COALESCE((a.context->>'window_hours')::int, 24), 1))
          AND ct.created_at <= a.created_at
          AND (EXISTS (SELECT 1 FROM public.union_clubs uc
                 WHERE uc.union_id=p_union_id AND uc.club_id=ct.club_id)
            OR EXISTS (SELECT 1 FROM public.clubs c
                 WHERE c.id=p_union_id AND c.is_union IS TRUE AND c.id=ct.club_id))
          AND public.fn_union_transfer_counts_as_dump(ct));

  /* A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000). An open alert
     closes on a re-measurement when it names no co-seating pair, none of its
     direct transfers is a dump, and no roster it names has a sustained 7-day
     edge now. Co-seating stays a review item for a person. */
  UPDATE financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = 'verified: re-measured; no agent roster it names holds a sustained 7-day edge (net > 10x rake), and none of its direct chip transfers is a player-to-player dump'
   WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved
     AND a.context->>'union_id' = p_union_id::text
     AND jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) e
        WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, (e->>'agent_user_id')::uuid, 7))
     AND NOT EXISTS (
       SELECT 1 FROM chip_transactions ct
        WHERE ct.created_at >= a.created_at - make_interval(hours => GREATEST(COALESCE((a.context->>'window_hours')::int, 24), 1))
          AND ct.created_at <= a.created_at
          AND (EXISTS (SELECT 1 FROM public.union_clubs uc
                 WHERE uc.union_id=p_union_id AND uc.club_id=ct.club_id)
            OR EXISTS (SELECT 1 FROM public.clubs c
                 WHERE c.id=p_union_id AND c.is_union IS TRUE AND c.id=ct.club_id))
          AND public.fn_union_transfer_counts_as_dump(ct));

  RETURN jsonb_build_object(
    'union_id', p_union_id, 'window_hours', p_hours, 'signals', v_total,
    'agent_roster_winning', v_agent_flags,
    'direct_chip_transfer', v_dump_flags,
    'co_seating', v_coseat_flags);
END $function$

