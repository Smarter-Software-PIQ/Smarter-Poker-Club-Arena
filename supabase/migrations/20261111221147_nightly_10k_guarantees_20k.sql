-- 20261111221147_nightly_10k_guarantees_20k.sql
--
-- Dan 2026-11-11, verbatim: "change the daily 10k guarantee at 7pm to a 20k
-- guarantee daily." Then: "CHANGE THE TITLE TO NIGHTLY 20K THOUGH. SO ITS
-- CHANGED VISUALLY CAUSE I ALREADY TOLD PLAYERS ABOUT IT." Then: "CHANGES
-- TONIGHTS TITLE NOW. AND KEEP WORKING ON THE PUBLICATION CHANGE TO TAKE
-- EFFECT TODAY IF POSSIBLE ... IT GETS 25K+ EVERY TIME."
--
-- The 7 PM Chicago Nightly (schedule 099ac5a4, Monday to Saturday) and its two
-- Satellite 5 feeders are hard coded by public.fn_ca_midway_weekly_catalog():
-- fn_tournament_schedule_board_is_hard_coded repopulates schedule rows from
-- the catalog, fn_ca_midway_weekly_terms copies catalog terms into every
-- spawn, and the feeders find their target by exact name
-- (config.satelliteTargetName). So the change is made at that source:
--
--   1. Catalog: the three entries say "Nightly 20K" wherever they said
--      "Nightly 10K" (event name, sourceName, config.name, terms.name, feeder
--      satelliteTargetName), and the Nightly's config.guaranteedPrize and
--      terms.guaranteed_prize become 20000. Days, time, buy-in, structure and
--      feeder economics are unchanged.
--   2. The three schedule rows are rewritten from the catalog.
--   3. Every open Nightly instance (not started, pool not finalized) is named
--      "Nightly 20K (NLH)" with a 20000 guarantee, and its open satellites take
--      the matching "Satellite Into Nightly 20K (NLH)" display name.
--
-- Tonight's instance (73e12a88, 7 PM 2026-11-11) already has entrants, so the
-- registered-contract guards refuse any name or guarantee edit. The owner
-- directed this one edit; public.fn_ca_owner_nightly_20k_admitted() admits
-- exactly it: that tournament id, as postgres, only inside this transaction's
-- app.owner_nightly_20k setting, still open, name 10K to 20K and guarantee
-- 10000 to 20000, with every other column unchanged. Raising a guarantee only
-- adds to what entrants can win. Every other registered edit stays refused.
--
-- Chips, not money. No new table, trigger, cron or repair loop.
-- @live-proof: (SELECT count(*)=1 AND bool_and(name='Nightly 20K (NLH)' AND config->>'guaranteedPrize'='20000' AND config#>>'{midwayWeeklyTerms,guaranteed_prize}'='20000') FROM public.tournament_schedules WHERE id='099ac5a4-c866-4acb-917c-31337bf468b1' AND active)

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

CREATE OR REPLACE FUNCTION public.fn_ca_owner_nightly_20k_admitted(p_old public.tournaments, p_new public.tournaments)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT current_user = 'postgres'
     AND p_old.id = '73e12a88-cb5c-444a-9e64-cbefb2d3d3b3'::uuid
     AND p_new.id = p_old.id
     AND coalesce(current_setting('app.owner_nightly_20k', true), '') = p_old.id::text
     AND upper(coalesce(p_old.status, '')) IN ('ANNOUNCED', 'REGISTERING')
     AND upper(coalesce(p_new.status, '')) = upper(coalesce(p_old.status, ''))
     AND p_old.started_at IS NULL AND p_new.started_at IS NULL
     AND NOT coalesce(p_old.prize_pool_finalized, false)
     AND NOT coalesce(p_new.prize_pool_finalized, false)
     AND p_old.name = 'Nightly 10K (NLH)' AND p_new.name = 'Nightly 20K (NLH)'
     AND p_old.guaranteed_prize = 10000 AND p_new.guaranteed_prize = 20000
     AND (to_jsonb(p_new) - ARRAY['name', 'guaranteed_prize', 'updated_at'])
       = (to_jsonb(p_old) - ARRAY['name', 'guaranteed_prize', 'updated_at'])
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_owner_nightly_20k_admitted(public.tournaments, public.tournaments) FROM PUBLIC, anon, authenticated;

DO $guards$
DECLARE
  src text;
  anchor text;
BEGIN
  src := pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure);
  anchor := E'BEGIN\n  IF TG_TABLE_NAME=''tournaments'' THEN\n    IF session_user=''postgres''';
  IF (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Lifecycle guard changed since qualification';
  END IF;
  EXECUTE replace(src, anchor, E'BEGIN\n  IF TG_TABLE_NAME=''tournaments'' AND TG_OP=''UPDATE'' THEN\n    IF public.fn_ca_owner_nightly_20k_admitted(OLD, NEW) THEN RETURN NEW; END IF;\n  END IF;\n  IF TG_TABLE_NAME=''tournaments'' THEN\n    IF session_user=''postgres''');

  src := pg_get_functiondef('public.trg_freeze_registered_tournament_settlement_contract()'::regprocedure);
  anchor := E'BEGIN\n  IF TG_TABLE_NAME=''tournaments'' AND public.fn_ca_midway_free_buy_conversion_transition';
  IF (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Settlement contract freeze changed since qualification';
  END IF;
  EXECUTE replace(src, anchor, E'BEGIN\n  IF TG_TABLE_NAME=''tournaments'' AND TG_OP=''UPDATE'' THEN\n    IF public.fn_ca_owner_nightly_20k_admitted(OLD, NEW) THEN RETURN NEW; END IF;\n  END IF;\n  IF TG_TABLE_NAME=''tournaments'' AND public.fn_ca_midway_free_buy_conversion_transition');
END $guards$;

DO $nightly$
DECLARE
  target constant uuid := '099ac5a4-c866-4acb-917c-31337bf468b1';
  feeders constant uuid[] := ARRAY['f54d66e4-4129-4bf1-8f0e-b267e4e08dfa','f44bc95c-6f9c-4e88-9aff-b767bab5c5a4']::uuid[];
  source text := pg_get_functiondef('public.fn_ca_midway_weekly_catalog()'::regprocedure);
  original text := split_part(source,'$catalog$',2);
  doc jsonb := original::jsonb;
  entry record;
  event jsonb;
  hits integer := 0;
  sat record;
BEGIN
  FOR entry IN SELECT value, ordinality FROM jsonb_array_elements(doc->'events') WITH ORDINALITY LOOP
    event := entry.value;
    CONTINUE WHEN NOT ((event->>'id')::uuid = target OR (event->>'id')::uuid = ANY(feeders));
    IF (event->>'id')::uuid = target THEN
      IF event->>'name' <> 'Nightly 10K (NLH)'
         OR (event#>>'{config,guaranteedPrize}')::numeric <> 10000
         OR (event#>>'{terms,guaranteed_prize}')::numeric <> 10000 THEN
        RAISE EXCEPTION 'Nightly 10K catalog entry changed since qualification';
      END IF;
      event := jsonb_set(event,'{config,guaranteedPrize}','20000');
      event := jsonb_set(event,'{terms,guaranteed_prize}','20000');
    ELSIF event#>>'{config,satelliteTargetName}' <> 'Nightly 10K (NLH)' THEN
      RAISE EXCEPTION 'Nightly feeder % changed since qualification', event->>'id';
    END IF;
    event := replace(event::text, 'Nightly 10K', 'Nightly 20K')::jsonb;
    doc := jsonb_set(doc,ARRAY['events',(entry.ordinality-1)::text],event);
    hits := hits + 1;
  END LOOP;
  IF hits <> 3 THEN RAISE EXCEPTION 'Expected the Nightly and its two feeders, found %', hits; END IF;
  EXECUTE replace(source,'$catalog$'||original||'$catalog$','$catalog$'||doc::text||'$catalog$');

  UPDATE public.tournament_schedules s SET config=r.config, name=r.name
  FROM jsonb_populate_recordset(NULL::public.tournament_schedules,public.fn_ca_midway_weekly_catalog()) r
  WHERE s.id=r.id AND (s.id=target OR s.id=ANY(feeders)) AND s.union_id=r.union_id;
  IF (SELECT count(*) FROM public.tournament_schedules
       WHERE id=target AND name='Nightly 20K (NLH)'
         AND (config->>'guaranteedPrize')::numeric=20000
         AND (config#>>'{midwayWeeklyTerms,guaranteed_prize}')::numeric=20000) <> 1
     OR (SELECT count(*) FROM public.tournament_schedules
          WHERE id=ANY(feeders) AND config->>'satelliteTargetName'='Nightly 20K (NLH)') <> 2 THEN
    RAISE EXCEPTION 'Nightly schedules did not take the 20K name and guarantee';
  END IF;

  -- Open instances nobody has entered.
  UPDATE public.tournaments t SET name='Nightly 20K (NLH)', guaranteed_prize=20000
  WHERE t.schedule_id=target AND t.name='Nightly 10K (NLH)' AND t.guaranteed_prize=10000
    AND t.status IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING') AND t.started_at IS NULL
    AND NOT coalesce(t.entry_contract_locked,false) AND NOT coalesce(t.prize_pool_finalized,false)
    AND NOT EXISTS (SELECT FROM public.tournament_players p WHERE p.tournament_id=t.id);

  -- Tonight's entered instance, by owner direction (see header).
  PERFORM set_config('app.owner_nightly_20k','73e12a88-cb5c-444a-9e64-cbefb2d3d3b3',true);
  UPDATE public.tournaments t SET name='Nightly 20K (NLH)', guaranteed_prize=20000
  WHERE t.id='73e12a88-cb5c-444a-9e64-cbefb2d3d3b3' AND t.name='Nightly 10K (NLH)' AND t.guaranteed_prize=10000
    AND t.status IN ('ANNOUNCED','REGISTERING') AND t.started_at IS NULL AND NOT coalesce(t.prize_pool_finalized,false);
  PERFORM set_config('app.owner_nightly_20k','',true);

  -- Open satellites take their target's display name (already admitted by the
  -- lifecycle guard's satellite display-name rule).
  FOR sat IN SELECT t.id FROM public.tournaments t
              JOIN public.tournaments g ON g.id=t.satellite_target_id
             WHERE g.schedule_id=target AND g.name='Nightly 20K (NLH)'
               AND t.name LIKE 'Satellite Into Nightly 10K%'
               AND t.status NOT IN ('COMPLETED','COMPLETING','CANCELLED') LOOP
    UPDATE public.tournaments SET name=replace(name,'Nightly 10K','Nightly 20K') WHERE id=sat.id;
  END LOOP;
END $nightly$;
COMMIT;
