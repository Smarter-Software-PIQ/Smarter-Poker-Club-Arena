-- @live-proof: strpos(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure),'one_earned_week_per_booking')>0
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='5s';
DO $install$
DECLARE
  runner text := pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure);
  old text;
  replacement text;
BEGIN
  -- Preserve independent changes to readiness and money posting. Require a
  -- unique source match at each booking boundary before replacing the owner.
  FOR old,replacement IN SELECT * FROM (VALUES
    ($a$WHERE p.period_end=e AND p.instance_id='weekly-payout-rounds') THEN$a$,
     $b$WHERE p.period_end=e AND p.instance_id='weekly-payout-rounds')
    AND NOT EXISTS(SELECT FROM public.weekly_accounting_payout_pauses p WHERE p.period_end<e
      AND p.instance_id='weekly-payout-rounds' AND p.phase<>'released' AND p.money_deadline_at>n) THEN$b$),
    ($a$WHERE p.period_end=e AND p.instance_id='weekly-payout-rounds' AND p.phase<>'released' ORDER BY p.attempt_no DESC LIMIT 1;$a$,
     $b$WHERE (p.period_end=e OR (p.period_end<e AND p.money_deadline_at>n)) AND p.instance_id='weekly-payout-rounds' AND p.phase<>'released' ORDER BY p.period_end,p.attempt_no DESC LIMIT 1;$b$),
    ($a$  SELECT COALESCE(max(attempt_no),0)+1 INTO att FROM public.weekly_accounting_payout_pauses WHERE period_end=e;$a$,
     $b$  -- one_earned_week_per_booking: original settlement and document owners
  -- identify a run by its actual closed week. Leave other weeks discoverable.
  SELECT min((s->>'period_end')::timestamptz) INTO e FROM jsonb_array_elements(ready) s
   WHERE NOT EXISTS(SELECT FROM public.weekly_accounting_payout_pauses p
      WHERE p.period_end=(s->>'period_end')::timestamptz AND p.phase<>'released');
  IF e IS NULL THEN RETURN jsonb_build_object('stage','engine_boundary_open'); END IF;
  SELECT jsonb_agg(s ORDER BY ord) INTO STRICT ready FROM jsonb_array_elements(ready) WITH ORDINALITY a(s,ord)
   WHERE (s->>'period_end')::timestamptz=e;
  SELECT COALESCE(max(attempt_no),0)+1 INTO att FROM public.weekly_accounting_payout_pauses WHERE period_end=e;$b$)
  ) AS edits(before_text,after_text) LOOP
    IF cardinality(string_to_array(runner,old))<>2 THEN RAISE EXCEPTION 'weekly_payout_backlog_anchor_changed: %',old; END IF;
    runner:=replace(runner,old,replacement);
  END LOOP;
  EXECUTE runner;
END $install$;
COMMIT;
