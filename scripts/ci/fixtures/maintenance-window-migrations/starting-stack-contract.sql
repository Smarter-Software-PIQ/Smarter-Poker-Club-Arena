-- Disposable native fixture only. Run after the actual trigger migrations.
-- A service writer is deliberately used: the browser contract guard does not
-- restrict that lane. No production purchase or wallet is invoked.
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  t public.tournaments;
  refused boolean;
BEGIN
  INSERT INTO public.tournaments(id,starting_chips,is_rebuy,is_reentry,
    add_on_available,rebuy_chips,addon_chips,rebuy_cost,addon_cost)
  VALUES('10000000-0000-0000-0000-000000000001',15000,true,false,true,10000,80000,35,35)
  RETURNING * INTO t;
  IF t.rebuy_chips<>15000 OR t.addon_chips<>15000 OR t.rebuy_cost<>35 OR t.addon_cost<>35 THEN
    RAISE EXCEPTION 'initial awards or prices are wrong';
  END IF;

  UPDATE public.tournaments SET starting_chips=20000 WHERE id=t.id RETURNING * INTO t;
  IF t.rebuy_chips<>20000 OR t.addon_chips<>20000 THEN
    RAISE EXCEPTION 'unregistered starting-stack update did not normalize both awards';
  END IF;
  INSERT INTO public.tournament_players(tournament_id) VALUES(t.id);

  -- The old unconditional registered-event return accepts each of these.
  refused:=false;
  BEGIN
    UPDATE public.tournaments SET rebuy_chips=10000 WHERE id=t.id;
  EXCEPTION WHEN check_violation THEN refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'registered service rebuy mismatch was accepted'; END IF;
  refused:=false;
  BEGIN
    UPDATE public.tournaments SET addon_chips=80000 WHERE id=t.id;
  EXCEPTION WHEN check_violation THEN refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'registered service addon mismatch was accepted'; END IF;
  refused:=false;
  BEGIN
    UPDATE public.tournaments SET starting_chips=30000 WHERE id=t.id;
  EXCEPTION WHEN check_violation THEN refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'registered starting-stack change left old awards'; END IF;

  -- A legitimate consistent service transition preserves prices.
  UPDATE public.tournaments SET starting_chips=30000,rebuy_chips=30000,addon_chips=30000
    WHERE id=t.id RETURNING * INTO t;
  IF t.rebuy_cost<>35 OR t.addon_cost<>35 THEN RAISE EXCEPTION 'prices changed'; END IF;
  refused:=false;
  BEGIN
    UPDATE public.tournaments SET seed_bad_awards=true WHERE id=t.id;
  EXCEPTION WHEN check_violation THEN refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'an earlier producer trigger bypassed the invariant'; END IF;

  -- Disabled options remain valid; enabling either must enforce its quantity.
  INSERT INTO public.tournaments(id,starting_chips,is_rebuy,is_reentry,
    add_on_available,rebuy_chips,addon_chips)
  VALUES('10000000-0000-0000-0000-000000000002',15000,false,false,false,10000,80000)
  RETURNING * INTO t;
  IF t.rebuy_chips<>10000 OR t.addon_chips<>80000 THEN RAISE EXCEPTION 'disabled options rewritten'; END IF;
  INSERT INTO public.tournament_players(tournament_id) VALUES(t.id);
  refused:=false;
  BEGIN
    UPDATE public.tournaments SET is_reentry=true WHERE id=t.id;
  EXCEPTION WHEN check_violation THEN refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'enabling registered reentry admitted a mismatch'; END IF;
  refused:=false;
  BEGIN
    UPDATE public.tournaments SET add_on_available=true WHERE id=t.id;
  EXCEPTION WHEN check_violation THEN refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'enabling registered addon admitted a mismatch'; END IF;

  -- Historical registered no-ops must not rewrite already-accounted supply.
  UPDATE public.tournaments SET rebuy_chips=rebuy_chips,addon_chips=addon_chips WHERE id=t.id;
  SELECT * INTO t FROM public.tournaments WHERE id=t.id;
  IF t.rebuy_chips<>10000 OR t.addon_chips<>80000 THEN RAISE EXCEPTION 'historical no-op changed supply'; END IF;

  UPDATE public.tournaments SET rebuy_chips=rebuy_chips,addon_chips=addon_chips
    WHERE id='10000000-0000-0000-0000-000000000003' RETURNING * INTO t;
  IF t.rebuy_chips<>10000 OR t.addon_chips<>80000 THEN
    RAISE EXCEPTION 'enabled historical no-op rewrote settled supply';
  END IF;
END;
$test$;
ROLLBACK;
