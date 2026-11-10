-- Total entry includes the fee. The public event label determines exclusions.
-- Nightly 10K is included by explicit owner direction despite its legacy preset.
-- @live-proof: (SELECT count(*)=4 AND bool_and(config->>'startingStack'='15000' AND config#>>'{blindStructure,0,smallBlind}'='25' AND config#>>'{blindStructure,0,bigBlind}'='50' AND config#>>'{midwayWeeklyTerms,starting_chips}'='15000') FROM public.tournament_schedules WHERE active AND union_id='fade0000-0000-0000-0000-000000000001' AND (config->>'buyIn')::numeric IN (35,40) AND name !~* 'deep[[:space:]_-]*stacks?|special[[:space:]_-]*events?')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

-- Edit the maintained catalog at the same boundary as the ten-level cutoff.
DO $opening$
DECLARE
  source text := pg_get_functiondef('public.fn_ca_midway_weekly_catalog()'::regprocedure);
  original text := split_part(source,'$catalog$',2);
  doc jsonb := original::jsonb;
  entry record;
  event jsonb;
  profile text;
  ladder jsonb;
  updated_ids uuid[] := '{}';
BEGIN
  IF md5(source) <> 'c06631c15783bad5a7123e9c29785a32' THEN
    RAISE EXCEPTION 'Midway weekly catalog changed since qualification';
  END IF;
  FOR entry IN SELECT value, ordinality FROM jsonb_array_elements(doc->'events') WITH ORDINALITY LOOP
    event := entry.value;
    IF (event#>>'{config,buyIn}')::numeric IN (35,40)
      AND event#>>'{terms,tournament_type}' = 'MTT'
      AND event->>'name' !~* 'deep[[:space:]_-]*stacks?|special[[:space:]_-]*events?' THEN
      profile := event->>'blindProfile';
      ladder := doc->'profiles'->profile;
      ladder := jsonb_set(ladder,'{0}',ladder->0 || '{"smallBlind":25,"bigBlind":50}'::jsonb);
      doc := jsonb_set(doc,ARRAY['profiles',profile||'-25-50'],ladder);
      event := jsonb_set(event,'{blindProfile}',to_jsonb(profile||'-25-50'));
      event := jsonb_set(event,'{config,startingStack}','15000');
      event := jsonb_set(event,'{terms,starting_chips}','15000');
      event := jsonb_set(event,'{terms,short_description}',to_jsonb(replace(event#>>'{terms,short_description}','10,000 Starting Chips','15,000 Starting Chips')));
      doc := jsonb_set(doc,ARRAY['events',(entry.ordinality-1)::text],event);
      updated_ids := array_append(updated_ids,(event->>'id')::uuid);
    END IF;
  END LOOP;
  IF cardinality(updated_ids) <> 4 THEN RAISE EXCEPTION 'Unexpected qualifying weekly schedules'; END IF;
  EXECUTE replace(source,'$catalog$'||original||'$catalog$','$catalog$'||doc::text||'$catalog$');

  UPDATE public.tournament_schedules s SET config=r.config
  FROM jsonb_populate_recordset(NULL::public.tournament_schedules,public.fn_ca_midway_weekly_catalog()) r
  WHERE s.id=r.id AND s.id=ANY(updated_ids) AND s.active AND s.union_id=r.union_id;

  UPDATE public.tournaments t SET starting_chips=15000,
    blind_structure=jsonb_set(t.blind_structure::jsonb,'{0}',t.blind_structure::jsonb->0 || '{"smallBlind":25,"bigBlind":50}'::jsonb)::text,
    short_description=replace(t.short_description,'10,000 Starting Chips','15,000 Starting Chips')
  WHERE t.schedule_id=ANY(updated_ids) AND t.union_id='fade0000-0000-0000-0000-000000000001'
    AND t.tournament_type='MTT' AND t.buy_in_amount+t.buy_in_fee IN (35,40)
    AND t.name !~* 'deep[[:space:]_-]*stacks?|special[[:space:]_-]*events?'
    AND t.status IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING') AND t.started_at IS NULL
    AND t.start_time>now() AND coalesce(t.current_level,0)=0 AND coalesce(t.current_players,0)=0
    AND NOT coalesce(t.entry_contract_locked,false) AND NOT coalesce(t.prize_pool_finalized,false)
    AND NOT EXISTS (SELECT FROM public.tournament_players p WHERE p.tournament_id=t.id);
END $opening$;
COMMIT;
