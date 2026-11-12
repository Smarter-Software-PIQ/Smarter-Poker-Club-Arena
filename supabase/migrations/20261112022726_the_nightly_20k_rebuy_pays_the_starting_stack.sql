-- @live-proof: NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.fn_ca_midway_weekly_catalog()) e WHERE (coalesce(e.value->'config'->>'isRebuy','false')='true' OR coalesce(e.value->'config'->>'addOnAvailable','false')='true') AND (coalesce(nullif(e.value->'config'->>'rebuyChips','')::numeric,-1) <> coalesce(nullif(e.value->'config'->>'startingStack','')::numeric,0) OR (coalesce(e.value->'config'->>'addOnAvailable','false')='true' AND coalesce(nullif(e.value->'config'->>'addOnChips','')::numeric,-1) <> coalesce(nullif(e.value->'config'->>'startingStack','')::numeric,0))))
-- ============================================================================
-- THE NIGHTLY 20K REBUY PAYS THE STARTING STACK (Dan 2026-11-11)
-- ============================================================================
--
-- Dan, verbatim (2026-11-11, 7:27 PM CT): "ANY TOURNAMENT THAT HAS A REBUY OR
-- AN ADD ON, MUST 100% OF THE TIME ALWAYS AND FOREVER GIVE THEM THE SAME
-- AMOUNT OF CHIPS YOU START WITH FOR REBUYS AND ADD ON'S." And: "MAKE SURE YOU
-- GRANT THE 5000 CHIPS TO ANY PLAYER WHO REBOUGHT THAT IS STILL IN THE
-- TOURNAMENT."
--
-- He reported it live from the Nightly 20K (NLH), tournament 73e12a88: a
-- rebuy credited 10,000 chips against the 15,000 starting stack. The money
-- core already pays COALESCE(NULLIF(rebuy_chips,0), starting_chips); the
-- short number came from tournaments.rebuy_chips, spawned from the owner
-- weekly schedule, whose rows are repopulated on every write from the hard
-- coded catalog fn_ca_midway_weekly_catalog()
-- (fn_tournament_schedule_board_is_hard_coded). The catalog's Nightly 20K
-- entry is therefore the root: it carries rebuyChips/addOnChips/addonChips
-- 10000 and midwayWeeklyTerms rebuy_chips/addon_chips 10000 against
-- startingStack/starting_chips 15000. No other catalog entry disagrees with
-- its own starting stack (read from production 02:26Z).
--
-- WHAT WAS ALREADY DONE, BY OWNER DIRECTION, THE SAME EVENING (01:55-02:25Z,
-- recorded here because the migration route was refused mid-event):
--   - tournaments 73e12a88 (RUNNING) and the three spawned Nightly 20K rows
--     (5a027147, 42354e3f, 27268410) had rebuy_chips raised 10000 -> 15000
--     through the service lane the lifecycle guard admits.
--   - Every entry in 73e12a88 that purchased a short rebuy/re-entry and still
--     held a live seat was credited its exact shortfall (starting_chips minus
--     the receipt's chips_added, summed per entry) behind
--     fn_ca_assert_tournament_chip_grant: 2 humans and 96 horses. Eight
--     busted entries without a live seat were not resurrected. One duplicate
--     human credit was reversed the same minute. Idempotency rows:
--     wallet_credit_idempotency keys 'rebuy_shortfall_20261112:%' and
--     'rebuy_shortfall_20261112_dup_reversal:%'.
--
-- THIS migration makes the catalog itself obey the ruling, exactly as
-- 20261111221147 amended the same entry for the 20K guarantee: qualify the
-- current bytes, patch the $catalog$ document in place, reinstall the
-- function, repopulate the schedule row from it and read it back.
--
-- 20261112013714 merged with a broader normalization (every unfinished
-- tournament row plus every schedule config): its tournament work was refused
-- by the registered-event lifecycle guard and then completed through the
-- admitted service lane as above, and its schedule loop also rewrote dozens
-- of INACTIVE legacy schedule configs, one owned by a retired club whose
-- rows are read-only, which refused the transaction whole. Those inactive
-- schedules spawn nothing; if one is ever reactivated, its spawned rows are
-- normalized at write time by zz_rebuy_pays_the_starting_stack
-- (20261112013925, daily window) and zz_addon_pays_the_starting_stack
-- (20261102005209). So 20261112013714 is superseded by this file and must
-- never run.
--
-- The write-time enforcement twin zz_rebuy_pays_the_starting_stack installs
-- in the daily maintenance window (20261112013925). No DDL here beyond
-- CREATE OR REPLACE of the catalog function, which live play does not lock.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

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
    CONTINUE WHEN (event->>'id')::uuid <> target;
    IF event->>'name' <> 'Nightly 20K (NLH)'
       OR (event#>>'{config,startingStack}')::numeric <> 15000
       OR (event#>>'{config,rebuyChips}')::numeric <> 10000
       OR (event#>>'{config,addOnChips}')::numeric <> 10000
       OR (event#>>'{config,addonChips}')::numeric <> 10000
       OR (event#>>'{terms,starting_chips}')::numeric <> 15000
       OR (event#>>'{terms,rebuy_chips}')::numeric <> 10000
       OR (event#>>'{terms,addon_chips}')::numeric <> 10000 THEN
      RAISE EXCEPTION 'Nightly 20K catalog entry changed since qualification';
    END IF;
    event := jsonb_set(event,'{config,rebuyChips}','15000');
    event := jsonb_set(event,'{config,addOnChips}','15000');
    event := jsonb_set(event,'{config,addonChips}','15000');
    event := jsonb_set(event,'{terms,rebuy_chips}','15000');
    event := jsonb_set(event,'{terms,addon_chips}','15000');
    doc := jsonb_set(doc,ARRAY['events',(entry.ordinality-1)::text],event);
    hits := hits + 1;
  END LOOP;
  IF hits <> 1 THEN RAISE EXCEPTION 'Expected exactly the Nightly 20K entry, found %', hits; END IF;
  EXECUTE replace(source,'$catalog$'||original||'$catalog$','$catalog$'||doc::text||'$catalog$');

  UPDATE public.tournament_schedules s SET config=r.config, name=r.name
  FROM jsonb_populate_recordset(NULL::public.tournament_schedules,public.fn_ca_midway_weekly_catalog()) r
  WHERE s.id=r.id AND s.id=target AND s.union_id=r.union_id;
  IF (SELECT count(*) FROM public.tournament_schedules
       WHERE id=target
         AND (config->>'rebuyChips')::numeric=15000
         AND (config->>'addOnChips')::numeric=15000
         AND (config->>'addonChips')::numeric=15000
         AND (config#>>'{midwayWeeklyTerms,rebuy_chips}')::numeric=15000
         AND (config#>>'{midwayWeeklyTerms,addon_chips}')::numeric=15000) <> 1 THEN
    RAISE EXCEPTION 'The Nightly 20K schedule did not take the starting-stack rebuy';
  END IF;
END $nightly$;
COMMIT;
