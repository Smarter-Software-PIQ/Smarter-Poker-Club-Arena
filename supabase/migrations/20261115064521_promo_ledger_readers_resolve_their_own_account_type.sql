-- Reserved by scripts/new-migration.mjs. Incidents dd614cd2 / db2d4189.
-- A typed promo_wallet identifies its promo column through its owner.
-- The three readers required the OTHER label to contain promo, dropping valid
-- unlabelled agent sends and claims and reporting 180 chips of fictitious drift.
-- Preserve explicit labels, unknown owners, every leg and snapshot semantics.
-- @live-proof: position('WHEN EXISTS (SELECT 1 FROM public.agents a' in pg_get_functiondef('public.fn_ca_leg_accounts(timestamptz,timestamptz)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $repair$
DECLARE r record; d text; a text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ca_leg_accounts(timestamp with time zone,timestamp with time zone)', '80663cfe1bcdbb0996d3267dc62ccd05'),
      ('public.fn_ca_leg_accounts_since_snapshot(timestamp with time zone,pg_snapshot)', '3f80c3a34b2b02970436cf6067f86890'),
      ('public.fn_ca_leg_accounts_since_snapshot_for(timestamp with time zone,pg_snapshot,uuid[])', '8f76e6446075900e7b8a7636beac52d1')
    ) AS inputs(signature, expected_hash)
  LOOP
    d := pg_get_functiondef(r.signature::regprocedure);
    IF md5(d) <> r.expected_hash THEN
      RAISE EXCEPTION 'PROMO_READER_PREIMAGE_CHANGED: %', r.signature;
    END IF;
    FOREACH a IN ARRAY ARRAY[
      'WHEN s.other_lbl LIKE ''%promo%'' AND EXISTS (SELECT 1 FROM public.agents a',
      'WHEN s.other_lbl LIKE ''%promo%'' AND EXISTS (SELECT 1 FROM public.unions u'
    ] LOOP
      IF (length(d)-length(replace(d,a,'')))/length(a) <> 1 THEN
        RAISE EXCEPTION 'PROMO_READER_ANCHOR_CHANGED: %', r.signature;
      END IF;
      d := replace(d, a, replace(a, 's.other_lbl LIKE ''%promo%'' AND ', ''));
    END LOOP;
    EXECUTE d;
    IF pg_get_functiondef(r.signature::regprocedure) <> d THEN
      RAISE EXCEPTION 'PROMO_READER_POSTIMAGE_CHANGED: %', r.signature;
    END IF;
  END LOOP;
END
$repair$;

-- Correct only the retained reading proved wrong by this source defect. Keep
-- the original witness and all journal rows. This is not a chip adjustment.
DO $evidence$
DECLARE
  v_key constant text := 'promo_wallet:47965354-0e56-43ef-931c-ddaab82af765:agents.promo_wallet_balance';
  v_owner constant uuid := '47965354-0e56-43ef-931c-ddaab82af765';
  v_inc constant uuid := '7b5937ca-770f-476f-bbc5-c3d7d655b944';
  b record; s record; v_net numeric; v_balance numeric; v_result jsonb;
  v_snapshot text; v_legs uuid[];
  v_note constant text := 'The promo ledger reader omitted 180.00 net chips from typed unlabelled promo transfers. The corrected reader accounts for all 100.00 chips since the zero baseline; the wallet is correct. No player balance, journal row or original reading was changed.';
BEGIN
  IF to_regclass('public.ca_drift_incidents') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id=v_inc) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_drift_incidents
      WHERE id=v_inc AND status IN ('open','acknowledged','reconciling')
        AND source='fn_ca_ledger_replay' AND discrepancy_amount=180
        AND expected_amount=-80 AND actual_amount=100) THEN
    RAISE EXCEPTION 'PROMO_INCIDENT_EVIDENCE_CHANGED';
  END IF;
  SELECT * INTO STRICT b FROM public.ca_account_snapshots WHERE id=48396 AND account_key=v_key;
  SELECT * INTO STRICT s FROM public.ca_account_snapshots
    WHERE account_key=v_key ORDER BY taken_at DESC LIMIT 1;
  IF b.balance IS DISTINCT FROM 0 OR s.id IS DISTINCT FROM 84765 OR s.balance IS DISTINCT FROM 100 OR s.unexplained IS DISTINCT FROM 180 OR s.cum_unexplained IS DISTINCT FROM 180
     OR b.read_snapshot IS NULL THEN RAISE EXCEPTION 'PROMO_READING_EVIDENCE_CHANGED'; END IF;
  -- One statement owns the balance, journal, visibility horizon and visible
  -- subtransaction legs even under the installer's READ COMMITTED isolation.
  SELECT a.net,
    (SELECT sum(promo_wallet_balance) FROM public.agents WHERE id=v_owner OR user_id=v_owner),
    pg_current_snapshot()::text,
    (SELECT COALESCE(array_agg(l.id ORDER BY l.id),'{}') FROM public.chip_ledger l
      WHERE l.created_at>now()-interval '30 minutes'
        AND public.fn_ca_xid8(l.xmin)>=pg_snapshot_xmin(pg_current_snapshot()))
  INTO STRICT v_net,v_balance,v_snapshot,v_legs
  FROM public.fn_ca_leg_accounts_since_snapshot_for(b.taken_at,b.read_snapshot::pg_snapshot,ARRAY[v_owner]) a
  WHERE a.account_key=v_key;
  IF v_net IS DISTINCT FROM 100 OR v_balance IS DISTINCT FROM 100 OR v_balance-b.balance-v_net IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'PROMO_READING_STILL_DISAGREES: journal %, balance %',v_net,v_balance;
  END IF;
  INSERT INTO public.ca_account_snapshots
    (account_key,account_type,entity_id,club_id,column_name,balance,taken_at,
     is_baseline,unexplained,cum_unexplained,basis_version,note,read_snapshot)
  VALUES(v_key,s.account_type,s.entity_id,s.club_id,s.column_name,v_balance,clock_timestamp(),
    false,0,0,s.basis_version,'20261115064521: '||v_note,v_snapshot);
  INSERT INTO public.ca_ledger_replay_readings(read_snapshot,read_at,committed_legs)
  VALUES(v_snapshot,clock_timestamp(),v_legs)
  ON CONFLICT(read_snapshot) DO NOTHING;
  v_result := public.fn_ca_incident_action(v_inc,'resolve',v_note,NULL,
    'Typed promo_wallet sides were wrongly made conditional on the opposite column label in all three fn_ca_leg_accounts readers.',
    'supabase/migrations/20261115064521_promo_ledger_readers_resolve_their_own_account_type.sql');
  IF v_result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'PROMO_INCIDENT_RESOLUTION_REFUSED: %',v_result;
  END IF;
END
$evidence$;

COMMIT;
