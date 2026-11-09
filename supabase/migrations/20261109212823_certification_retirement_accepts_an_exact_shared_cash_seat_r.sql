-- 20261109212823_certification_retirement_accepts_an_exact_shared_cash_seat_r.sql
-- Reserved by scripts/new-migration.mjs. Source only; no account is retired here.
-- A reserved player cashed out normally from the live shared PLO table, with
-- exact occupancy receipt and posted wallet credit, then returned its wallet
-- balance. Requiring that shared table to close still misclassified its old
-- seat as custody. Accept only that complete cash-occupancy receipt, with no
-- live cash session, pool membership, reservation or departure request.
-- Preserve all existing namespace, balance, authority, ledger, freeze and
-- Auth-retirement guards, including the original posted cashout ledger test.
-- Unreceipted transfers, tournament seats and unknown outcomes remain refused.
-- @live-proof: position('cr.occupancy_id = s.occupancy_id' IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) > 0 AND position('cr.occupancy_id = s.occupancy_id' IN pg_get_functiondef('public.fn_ca_certification_identity_retired(uuid)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $patch$
DECLARE
  sig regprocedure;
  d text;
  before_meta jsonb;
  n integer;
  expected text;
  old CONSTANT text := $old$lower(COALESCE(t.status::text, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished')$old$;
  replacement CONSTANT text := $new$(lower(COALESCE(t.status::text, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished')
                            AND NOT (t.tournament_id IS NULL AND EXISTS (
                              SELECT 1 FROM public.seat_cashout_receipts cr
                               WHERE cr.occupancy_id = s.occupancy_id AND cr.seat_id = s.id
                                 AND cr.user_id = s.user_id AND cr.table_id = s.table_id
                                 AND cr.seat_number = s.seat_number
                                 AND cr.receipt @> jsonb_build_object(
                                   'ok', true, 'credited', true, 'tournament_table', false,
                                   'stack', s.stack, 'user_id', s.user_id,
                                   'table_id', s.table_id, 'seat_number', s.seat_number,
                                   'occupancy_id', s.occupancy_id,
                                   'idempotency_key', 'cashout:occupancy:' || s.occupancy_id::text))
                              AND NOT EXISTS (SELECT 1 FROM public.cash_player_session cs
                                WHERE cs.player_id = s.user_id AND cs.closed_at IS NULL)
                              AND NOT EXISTS (SELECT 1 FROM public.lightning_pool_session ps
                                WHERE ps.player_id = s.user_id AND ps.exited_at IS NULL)
                              AND NOT EXISTS (SELECT 1 FROM public.lightning_reservation lr
                                WHERE lr.player_id = s.user_id AND lr.state IN ('pending', 'committed'))
                              AND NOT EXISTS (SELECT 1 FROM public.seat_departure_requests dr
                                WHERE dr.user_id = s.user_id)))$new$;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.cleanup_reserved_certification_account(uuid)'::regprocedure,
    'public.fn_ca_certification_identity_retired(uuid)'::regprocedure]
  LOOP
    expected := CASE WHEN sig::oid = 'public.cleanup_reserved_certification_account(uuid)'::regprocedure::oid
      THEN 'b5726d7e1d42b04a87b880cafd786e9e' ELSE '06cbde5561c16d8dafa18e36f04fece9' END;
    d := pg_get_functiondef(sig);
    IF md5(d) <> expected THEN
      RAISE EXCEPTION 'SHARED_CASH_CERTIFICATION_PREIMAGE_CHANGED: %', sig;
    END IF;
    SELECT jsonb_build_object('owner', proowner, 'acl', proacl, 'config', proconfig,
      'secdef', prosecdef, 'volatility', provolatile) INTO before_meta FROM pg_proc WHERE oid=sig;
    n := (length(d)-length(replace(d,old,'')))/length(old);
    IF n <> (CASE WHEN sig::oid = 'public.cleanup_reserved_certification_account(uuid)'::regprocedure::oid THEN 2 ELSE 1 END) THEN
      RAISE EXCEPTION 'SHARED_CASH_CERTIFICATION_GUARD_COUNT: %', sig;
    END IF;
    EXECUTE replace(d,old,replacement);
    IF (SELECT jsonb_build_object('owner', proowner, 'acl', proacl, 'config', proconfig,
      'secdef', prosecdef, 'volatility', provolatile) FROM pg_proc WHERE oid=sig) IS DISTINCT FROM before_meta
      OR pg_get_functiondef(sig) IS DISTINCT FROM replace(d,old,replacement) THEN
      RAISE EXCEPTION 'SHARED_CASH_CERTIFICATION_POSTIMAGE_CHANGED: %', sig;
    END IF;
  END LOOP;
END
$patch$;
COMMIT;
