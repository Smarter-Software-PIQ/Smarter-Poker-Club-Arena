-- Read-only, on-demand review input. Run with the configured privileged reader.
-- No DDL, publication, cancellation, registration or wallet writes.
-- Keep the horizon aligned with ScheduledTournamentService.spawnAheadMsFor.
WITH schedules AS MATERIALIZED (
 SELECT s.*,greatest(CASE WHEN coalesce((config->>'buyIn')::numeric,0)>=200 THEN 8640 ELSE 4320 END,
 CASE WHEN (config->>'spawnAheadMinutes')::numeric BETWEEN 30 AND 10080
 THEN round((config->>'spawnAheadMinutes')::numeric) ELSE 0 END) window_minutes
 FROM public.tournament_schedules s
 WHERE s.active AND (s.club_id='fade0000-0000-0000-0000-000000000001'
 OR s.union_id='fade0000-0000-0000-0000-000000000001')
), occurrences AS MATERIALIZED (
 SELECT t.*,extract(dow FROM t.start_time AT TIME ZONE 'America/Chicago')::integer local_day,
 to_char(t.start_time AT TIME ZONE 'America/Chicago','HH24:MI') local_time
 FROM public.tournaments t
 WHERE (t.club_id='fade0000-0000-0000-0000-000000000001'
 OR t.union_id='fade0000-0000-0000-0000-000000000001')
 AND t.status IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING','RUNNING','BREAK')
 AND t.schedule_id IS NOT NULL
), slots AS (
 SELECT s.id,s.config,s.window_minutes,day,tm,
 min((d::date+tm::time) AT TIME ZONE 'America/Chicago') start_at
 FROM schedules s CROSS JOIN LATERAL unnest(s.days_of_week) day
 CROSS JOIN LATERAL unnest(s.start_times_utc) tm
 CROSS JOIN generate_series((now() AT TIME ZONE 'America/Chicago')::date,
 (now() AT TIME ZONE 'America/Chicago')::date+8,interval '1 day') d
 WHERE extract(dow FROM d)::integer=day
 AND ((d::date+tm::time) AT TIME ZONE 'America/Chicago')>=now()
 GROUP BY s.id,s.config,s.window_minutes,day,tm
), booking AS (
 SELECT s.*,p.total,p.first_start,p.open_count,
 CASE WHEN p.total>1 OR p.term_conflicts>0 THEN 'Conflict'
 WHEN p.total=1 AND p.open_count=1 THEN 'Open for registration'
 WHEN p.total=1 THEN 'Published'
 WHEN s.start_at>=now()+s.window_minutes*interval '1 minute' THEN 'Outside booking window'
 WHEN s.config->>'satelliteTargetName' IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM occurrences t JOIN schedules target ON target.id=t.schedule_id
 WHERE target.name=s.config->>'satelliteTargetName' AND t.status IN ('ANNOUNCED','REGISTERING')
 AND t.started_at IS NULL AND t.start_time>s.start_at
 AND t.satellite_target_id IS NULL AND t.satellite_target IS NULL
 AND t.format_contract IN ('mtt-v1','mtt-v2') AND t.max_players IS NULL
 AND t.is_premium_spin IS FALSE AND t.is_bounty IS NOT NULL
 AND t.is_pko IS NOT NULL AND t.is_mystery_bounty IS NOT NULL
 ) THEN CASE WHEN EXISTS (
 SELECT 1 FROM public.tournaments cancelled JOIN schedules target ON target.id=cancelled.schedule_id
 WHERE target.name=s.config->>'satelliteTargetName'
 AND cancelled.status IN ('CANCELLED','CANCELED') AND cancelled.start_time>s.start_at
 ) THEN 'Missing' ELSE 'Waiting for target' END
 ELSE 'Missing' END booking_status
 FROM slots s LEFT JOIN LATERAL (
 SELECT count(*) total,min(t.start_time) first_start,
 count(*) FILTER (WHERE t.status='REGISTERING') open_count,
 count(*) FILTER (WHERE t.started_at IS NULL AND t.status IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING')
 AND (s.config->'midwayWeeklyTerms' IS NULL
 OR NOT ((to_jsonb(t)-'blind_structure') @> ((s.config->'midwayWeeklyTerms')-'blind_structure'))
 OR t.blind_structure::jsonb IS DISTINCT FROM (s.config->'midwayWeeklyTerms'->>'blind_structure')::jsonb)) term_conflicts
 FROM occurrences t WHERE t.schedule_id=s.id AND t.start_time=s.start_at
 ) p ON true
)
SELECT jsonb_build_object(
 'schemaVersion',1,'asOf',now(),'timeZone','America/Chicago',
 'revision','owner-sheet-2026-11-07-v1',
 'events',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'name',name,'days',days_of_week,'times',start_times_utc,
 'timeZone',time_zone,'config',config-'midwayWeeklyTerms'-'blindStructure','terms',config->'midwayWeeklyTerms') ORDER BY id),'[]'::jsonb) FROM schedules),
 'occurrences',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',t.id,'scheduleId',t.schedule_id,'startTime',t.start_time,'status',t.status,
 'startedAt',t.started_at,'finalized',coalesce(t.prize_pool_finalized,false),
 'registrations',r.total,'refundChips',e.gross,'fundedByTickets',e.tickets,
 'satelliteSeatEntries',e.seats,'refundCoverageComplete',r.missing=0,
 'refundAuthorityVerified',false,'cancellationRefundStatus','requires_exact_authority') ORDER BY t.start_time,t.id),'[]'::jsonb)
 FROM occurrences t LEFT JOIN LATERAL (
 SELECT count(*) total,count(*) FILTER (WHERE NOT EXISTS (
 SELECT 1 FROM public.tournament_refund_entitlements e WHERE e.tournament_id=t.id AND e.user_id=p.user_id)) missing
 FROM public.tournament_players p WHERE p.tournament_id=t.id
 ) r ON true LEFT JOIN LATERAL (
 SELECT coalesce(sum(gross),0) gross,
 count(*) FILTER (WHERE entitlement_kind='tournament_ticket') tickets,
 count(*) FILTER (WHERE entitlement_kind='satellite_seat') seats
 FROM public.tournament_refund_entitlements e WHERE e.tournament_id=t.id
 AND e.entitlement_kind IN ('wallet_charge','satellite_seat','tournament_ticket')
 AND NOT EXISTS (SELECT 1 FROM public.tournament_refund_tranches r WHERE r.entitlement_id=e.id)
 AND NOT EXISTS (SELECT 1 FROM public.tournament_tickets k WHERE k.source_refund_entitlement_id=e.id)
 ) e ON true),
 'statuses',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'scheduleId',id,'day',day,'time',tm,'bookingStatus',booking_status,
 'expectedStart',start_at,'nextPublishedStart',first_start) ORDER BY day,tm,id),'[]'::jsonb) FROM booking)
) AS snapshot;
