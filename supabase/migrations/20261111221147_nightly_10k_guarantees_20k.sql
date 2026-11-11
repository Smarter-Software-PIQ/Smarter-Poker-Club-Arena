-- 20261111221147_nightly_10k_guarantees_20k.sql
--
-- Dan 2026-11-11, verbatim: "change the daily 10k guarantee at 7pm to a 20k
-- guarantee daily."
--
-- The Nightly 10K (NLH), schedule 099ac5a4, 7:00 PM America/Chicago, Monday
-- to Saturday, is hard coded by public.fn_ca_midway_weekly_catalog():
-- fn_tournament_schedule_board_is_hard_coded repopulates the schedule row from
-- the catalog on every write, and fn_ca_midway_weekly_terms copies the
-- catalog terms into every spawned tournament. So the guarantee is changed at
-- that source, in the same way 20261110024000 edited the catalog:
--
--   1. The catalog entry's config.guaranteedPrize and terms.guaranteed_prize
--      become 20000. Nothing else in the catalog changes (name, days, time,
--      buy-in, structure, satellites stay as they are).
--   2. The schedule row is rewritten from the catalog.
--   3. Already spawned future instances that nobody has entered yet take the
--      new guarantee. An instance with an entrant keeps its guarantee:
--      trg_freeze_registered_tournament_settlement_contract freezes the
--      settlement contract after the first entrant, and this migration does
--      not open that freeze.
--
-- Chips, not money. No new table, trigger, cron or repair loop.
-- @live-proof: (SELECT count(*)=1 AND bool_and(config->>'guaranteedPrize'='20000' AND config#>>'{midwayWeeklyTerms,guaranteed_prize}'='20000') FROM public.tournament_schedules WHERE id='099ac5a4-c866-4acb-917c-31337bf468b1' AND active)

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

DO $nightly$
DECLARE
  target constant uuid := '099ac5a4-c866-4acb-917c-31337bf468b1';
  source text := pg_get_functiondef('public.fn_ca_midway_weekly_catalog()'::regprocedure);
  original text := split_part(source,'$catalog$',2);
  doc jsonb := original::jsonb;
  entry record;
  event jsonb;
  hits integer := 0;
BEGIN
  FOR entry IN SELECT value, ordinality FROM jsonb_array_elements(doc->'events') WITH ORDINALITY LOOP
    event := entry.value;
    CONTINUE WHEN event->>'id' <> target::text;
    IF event->>'name' <> 'Nightly 10K (NLH)'
       OR (event#>>'{config,guaranteedPrize}')::numeric <> 10000
       OR (event#>>'{terms,guaranteed_prize}')::numeric <> 10000 THEN
      RAISE EXCEPTION 'Nightly 10K catalog entry changed since qualification';
    END IF;
    event := jsonb_set(event,'{config,guaranteedPrize}','20000');
    event := jsonb_set(event,'{terms,guaranteed_prize}','20000');
    doc := jsonb_set(doc,ARRAY['events',(entry.ordinality-1)::text],event);
    hits := hits + 1;
  END LOOP;
  IF hits <> 1 THEN RAISE EXCEPTION 'Expected exactly one Nightly 10K catalog entry, found %', hits; END IF;
  EXECUTE replace(source,'$catalog$'||original||'$catalog$','$catalog$'||doc::text||'$catalog$');

  UPDATE public.tournament_schedules s SET config=r.config
  FROM jsonb_populate_recordset(NULL::public.tournament_schedules,public.fn_ca_midway_weekly_catalog()) r
  WHERE s.id=r.id AND s.id=target AND s.union_id=r.union_id;
  IF NOT EXISTS (SELECT FROM public.tournament_schedules
                  WHERE id=target AND (config->>'guaranteedPrize')::numeric=20000
                    AND (config#>>'{midwayWeeklyTerms,guaranteed_prize}')::numeric=20000) THEN
    RAISE EXCEPTION 'Nightly schedule did not take the 20K guarantee';
  END IF;

  UPDATE public.tournaments t SET guaranteed_prize=20000
  WHERE t.schedule_id=target AND t.guaranteed_prize=10000
    AND t.status IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING') AND t.started_at IS NULL
    AND t.start_time>now() AND coalesce(t.current_players,0)=0
    AND NOT coalesce(t.entry_contract_locked,false) AND NOT coalesce(t.prize_pool_finalized,false)
    AND NOT EXISTS (SELECT FROM public.tournament_players p WHERE p.tournament_id=t.id);
END $nightly$;
COMMIT;
