-- @live-proof: position('tournament-purchases:' in pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='readable tournaments receive purchase signals')
-- Confirmed add-on purchases wake the existing break standings read, including
-- purchases by players at other tables. No player identity or balance is sent.
-- The private receive policy reuses tournaments RLS; no client send is granted.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
CREATE POLICY "readable tournaments receive purchase signals"
ON realtime.messages FOR SELECT TO authenticated
USING (extension='broadcast' AND topic=realtime.topic() AND EXISTS (
  SELECT 1 FROM public.tournaments t WHERE t.id=CASE
    WHEN realtime.topic() ~ '^tournament-purchases:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(realtime.topic(),':',2)::uuid ELSE NULL END
));
DO $patch$
DECLARE d text; needle text := $old$  RETURN v_recorded;
EXCEPTION WHEN OTHERS THEN$old$;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure) IS DISTINCT FROM '54524e455599caa5f97bc71657b7d47b' THEN
    RAISE EXCEPTION 'ADDON_COUNTER_PURCHASE_PREIMAGE_CHANGED';
  END IF;
  d:=pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure);
  IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'ADDON_COUNTER_PURCHASE_ANCHOR_CHANGED';
  END IF;
  d:=replace(d,needle,$new$  -- Enqueued in the purchase transaction: rollback publishes nothing.
  -- Receipt replay returns earlier and cannot create a second purchase signal.
  IF v_type='addon' THEN
    PERFORM realtime.send('{}'::jsonb,'purchase_committed',
      'tournament-purchases:'||p_tournament_id::text,true);
  END IF;
  RETURN v_recorded;
EXCEPTION WHEN OTHERS THEN$new$);
  EXECUTE d;
END $patch$;
COMMIT;
