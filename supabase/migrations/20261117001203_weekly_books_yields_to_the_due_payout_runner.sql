-- @live-proof: position('weekly_payout_owned_by_round_runner' in pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='5s';
DO $install$
DECLARE
  original text := pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure);
  anchor constant text := E'\n IF jsonb_array_length(plan)=0 THEN RETURN NULL;END IF;';
BEGIN
  IF md5(original)<>'b74ade398c53fc375940a941997d5ae6' OR strpos(original,anchor)=0 THEN
    RAISE EXCEPTION 'weekly_preparation_owner_changed';
  END IF;
  EXECUTE replace(original,anchor,anchor||$handoff$
 -- The minute runner owns both admission and payment after maintenance.
 -- Leave the five-minute tick available for books once every scope is paid.
 IF n>=due AND n<due+interval '24 hours'
    AND EXISTS(SELECT FROM smarter_private.weekly_payout_rounds_config WHERE singleton AND enabled) THEN
  RETURN jsonb_build_object('success',true,'owns_tick',true,'advanced',false,
    'stage','weekly_payout_owned_by_round_runner','owed_scopes',jsonb_array_length(plan));
 END IF;
$handoff$);
END
$install$;
COMMIT;
