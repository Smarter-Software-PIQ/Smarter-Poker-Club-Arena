-- @install-window: daily-maintenance
-- @locks: public.ca_promo_cash_hand_clocks
-- @live-proof: (md5(pg_get_functiondef('public.fn_ca_promo_capture_cash_hand_clock(uuid,uuid)'::regprocedure))='b6c07612249fddae6ce5ef52a9fc339e' AND md5(pg_get_functiondef('public.fn_ca_promo_cash_clock_is_immutable()'::regprocedure))='9de97a9b928999f76a7ad1cbeed5ebc3' AND NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN ('public.fn_ca_promo_capture_cash_hand_clock(uuid,uuid)'::regprocedure,'public.fn_ca_promo_cash_clock_is_immutable()'::regprocedure) AND a.grantee<>p.proowner AND a.privilege_type='EXECUTE'))
-- @live-proof: ((SELECT count(*)=5 FROM pg_attribute a JOIN (VALUES ('observation_order','bigint'::regtype),('writer_xid','xid8'::regtype),('visible_xids','pg_snapshot'::regtype),('observed_at','timestamptz'::regtype),('lightning_anchors','jsonb'::regtype)) c(col,typ) ON c.col=a.attname AND c.typ=a.atttypid WHERE a.attrelid='public.ca_promo_cash_hand_clocks'::regclass AND NOT a.attisdropped AND NOT a.attnotnull AND NOT a.atthasdef) AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ca_promo_cash_hand_clocks'::regclass AND conname='ca_promo_hand_clock_has_entire_observation' AND contype='c') AND (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='public.ca_promo_cash_hand_clocks'::regclass AND tgfoid='public.fn_ca_promo_cash_clock_is_immutable()'::regprocedure AND tgenabled='O' AND (tgname,tgtype) IN (('ca_promo_cash_clock_immutable',27),('ca_promo_cash_clock_no_truncate',34))))
-- Preserve the original hand's transaction visibility alongside its existing
-- accepted clock. Original requests already retain both sides' contributions,
-- stacks and source generation. A Lightning hand also needs its anchors'
-- occupancy IDs while its original settlement still owns those seats.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

LOCK TABLE public.ca_promo_cash_hand_clocks IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_promo_capture_cash_hand_clock(uuid,uuid)'::regprocedure))
    <> 'cadf2bd5c2a0c51da39d4f86f934d88f'
 OR md5(pg_get_functiondef('public.fn_ca_promo_cash_clock_is_immutable()'::regprocedure))
    <> '46168fe107b8a1c53fd366d977d687c1'
 OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_promo_source_observation()')))
    IS DISTINCT FROM '47446dcf434e02ff6457c4270e9e38a6' THEN
  RAISE EXCEPTION 'original hand clock or source observation dependency changed';
 END IF;
END $guard$;

ALTER TABLE public.ca_promo_cash_hand_clocks
 ADD COLUMN observation_order bigint,
 ADD COLUMN writer_xid xid8,
 ADD COLUMN visible_xids pg_snapshot,
 ADD COLUMN observed_at timestamptz,
 ADD COLUMN lightning_anchors jsonb,
 ADD CONSTRAINT ca_promo_hand_clock_has_entire_observation CHECK (
  num_nonnulls(observation_order,writer_xid,visible_xids,observed_at,lightning_anchors)=0
  OR (num_nonnulls(observation_order,writer_xid,visible_xids,observed_at,lightning_anchors)=5
      AND observation_order>0 AND isfinite(observed_at) AND jsonb_typeof(lightning_anchors)='array')
 ) NOT VALID;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_capture_cash_hand_clock(p_hand uuid,p_table uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE h public.hand_atomic_commits%ROWTYPE; prior public.ca_promo_cash_hand_clocks%ROWTYPE;
 stamp record; anchors jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN RETURN; END IF;
 SELECT * INTO h FROM public.hand_atomic_commits WHERE hand_id=p_hand AND table_id=p_table;
 IF NOT FOUND OR h.committed_at IS NULL OR NOT isfinite(h.committed_at) THEN
  RAISE EXCEPTION 'promo_cash_original_accepted_hand_missing' USING ERRCODE='23514'; END IF;

 SELECT * INTO prior FROM public.ca_promo_cash_hand_clocks WHERE hand_id=p_hand;
 IF NOT FOUND THEN
  -- A historical recovered receipt can keep its original clock, but only the
  -- same full transaction that wrote its accepted request can observe itself.
  IF EXISTS (SELECT 1 FROM public.cash_hand_provenance_receipts r
     WHERE r.hand_id=p_hand AND r.table_id=p_table AND r.hand_number=h.hand_number
       AND r.transaction_id=pg_current_xact_id_if_assigned()) THEN
   SELECT * INTO STRICT stamp FROM public.fn_ca_promo_source_observation();
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'player_id',m.player_id,'hand_id',m.hand_id,'table_id',m.anchor_table_id,'seat_id',m.seat_id,
      'occupancy_id',s.occupancy_id,'seat_joined_at',s.joined_at) ORDER BY m.player_id,m.seat_id), '[]'::jsonb) INTO anchors
   FROM public.lightning_settlement_marker m
   LEFT JOIN public.table_seats s ON s.id=m.seat_id AND s.table_id=m.anchor_table_id AND s.user_id=m.player_id
   WHERE m.txid=stamp.writer_xid AND m.host_table_id=p_table AND m.hand_number=h.hand_number;
   INSERT INTO public.ca_promo_cash_hand_clocks
    (hand_id,table_id,hand_number,accepted_at,observation_order,writer_xid,visible_xids,observed_at,lightning_anchors)
    VALUES(h.hand_id,h.table_id,h.hand_number,h.committed_at,stamp.observation_order,stamp.writer_xid,stamp.visible_xids,stamp.observed_at,anchors)
    ON CONFLICT(hand_id) DO NOTHING;
  ELSE
   INSERT INTO public.ca_promo_cash_hand_clocks(hand_id,table_id,hand_number,accepted_at)
    VALUES(h.hand_id,h.table_id,h.hand_number,h.committed_at) ON CONFLICT(hand_id) DO NOTHING;
  END IF;
  IF FOUND THEN RETURN; END IF;
  SELECT * INTO STRICT prior FROM public.ca_promo_cash_hand_clocks WHERE hand_id=p_hand;
 END IF;
 IF ROW(prior.table_id,prior.hand_number,prior.accepted_at) IS DISTINCT FROM ROW(h.table_id,h.hand_number,h.committed_at) THEN
  RAISE EXCEPTION 'original_promo_cash_hand_clock_conflict' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_cash_clock_is_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.profit_capture_version IS NULL AND NEW.profit_capture_version=1
  AND ROW(NEW.hand_id,NEW.table_id,NEW.hand_number,NEW.accepted_at,NEW.observation_order,NEW.writer_xid,NEW.visible_xids::text,NEW.observed_at,NEW.lightning_anchors)
      IS NOT DISTINCT FROM ROW(OLD.hand_id,OLD.table_id,OLD.hand_number,OLD.accepted_at,OLD.observation_order,OLD.writer_xid,OLD.visible_xids::text,OLD.observed_at,OLD.lightning_anchors)
  THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'original_promo_cash_hand_clock_is_immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_capture_cash_hand_clock(uuid,uuid),public.fn_ca_promo_cash_clock_is_immutable()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
