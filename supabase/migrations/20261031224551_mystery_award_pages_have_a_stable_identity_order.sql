-- Mystery award pages need a total order when reveal timestamps tie.
-- Actual PostgreSQL17 reproduction:1002 paid awards at one timestamp yielded
--1002 rows but only1001 distinct identities across six pages. Tie-break both
-- the bounded selection and JSON aggregate by the immutable award ID.
-- No award, recipient, amount, status, visibility or permission changes.
-- @live-proof: (SELECT md5(prosrc) = 'ddaaf3f1db53ca1e593adb19123143d4' FROM pg_proc WHERE oid = 'public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure)
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';
DO $migration$
DECLARE definition text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure)
       IS DISTINCT FROM 'bb3ac5f9b86f3819919b2d1fe51313d5' THEN
    RAISE EXCEPTION 'MYSTERY_AWARD_ORDER_PREIMAGE_CHANGED';
  END IF;
  definition := pg_get_functiondef('public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure);
  definition := replace(definition, 'ORDER BY r.revealed_at DESC NULLS LAST', 'ORDER BY r.revealed_at DESC NULLS LAST, r.award_id DESC');
  definition := replace(definition, 'ORDER BY a.revealed_at DESC NULLS LAST', 'ORDER BY a.revealed_at DESC NULLS LAST, a.id DESC');
  EXECUTE definition;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure)
       IS DISTINCT FROM 'ddaaf3f1db53ca1e593adb19123143d4' THEN
    RAISE EXCEPTION 'MYSTERY_AWARD_ORDER_POSTIMAGE_CHANGED';
  END IF;
END;
$migration$;
COMMIT;
