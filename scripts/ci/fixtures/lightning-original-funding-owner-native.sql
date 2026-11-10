-- Synthetic extension of the actual maintained Lightning settlement chain.
-- The driver forms/settles funding_owner publicly before loading current owners.
-- These tests never alter an original outcome, resolution or financial receipt.
ALTER TABLE public.cash_participant_funding_receipts
 ADD COLUMN IF NOT EXISTS table_id uuid,
 ADD COLUMN IF NOT EXISTS account_entity_id uuid,
 ADD COLUMN IF NOT EXISTS operation_kind text,
 ADD COLUMN IF NOT EXISTS user_id uuid,
 ADD COLUMN IF NOT EXISTS seat_id uuid,
 ADD COLUMN IF NOT EXISTS recorded_at timestamptz,
 ADD COLUMN IF NOT EXISTS occupancy_id uuid,
 ADD COLUMN IF NOT EXISTS funding_club_id uuid,
 ADD COLUMN IF NOT EXISTS funding_union_id uuid,
 ADD COLUMN IF NOT EXISTS asset text;

CREATE FUNCTION harness.funding_owner_original_rows() RETURNS text LANGUAGE sql SET TimeZone TO 'UTC' AS $f$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY table_id,hand_number)FROM public.union_pnl_cash_outcomes x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY table_id,hand_number)FROM public.union_pnl_cash_outcome_link_resolutions x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY hand_id)FROM public.hand_atomic_commits x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY id)FROM public.hand_history x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY hand_id)FROM public.lightning_hand x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY hand_id,player_id)FROM public.lightning_hand_player x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY id)FROM public.cash_player_session x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY id)FROM public.lightning_pool_session x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY id)FROM public.lightning_pool_slot x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY id)FROM public.cash_participant_funding_receipts x),
  (SELECT jsonb_agg(to_jsonb(x)ORDER BY to_jsonb(x)::text)FROM public.table_seats x))::text)
$f$;

DO $funding_owner$
DECLARE c record;r record;person jsonb;corrected jsonb;actual jsonb;baseline text;
 fund uuid:='f0000000-0000-4000-8000-000000000001'; other uuid:='f0000000-0000-4000-8000-000000000002';
 game_union uuid; started timestamptz; first_user uuid; first_occupancy uuid; first_receipt uuid;
 denied integer:=0; role_name text; bad jsonb; refused boolean;
BEGIN
 SELECT h.*,k.game INTO STRICT c FROM public.lightning_hand h
 JOIN harness.pnl_cases k ON k.hand_id=h.hand_id WHERE k.label='funding_owner';
 SELECT * INTO STRICT r FROM public.union_pnl_cash_outcome_link_resolutions
 WHERE table_id=c.host_table_id AND hand_number=c.hand_number;
 game_union:=(r.game_scope->>'game_union_id')::uuid;
 SELECT hh.started_at INTO STRICT started FROM public.hand_history hh WHERE hh.id=c.hand_history_id;
 IF game_union IS NULL OR r.roster_source<>'lightning_pool' OR jsonb_array_length(r.evidence->'participants')<>4
  OR EXISTS(SELECT FROM jsonb_array_elements(r.evidence->'participants')p WHERE p->>'earning_club_id'IS DISTINCT FROM game_union::text)
 THEN RAISE EXCEPTION 'funding_owner_fixture_requires_real_public_union_custody';END IF;
 -- Original captured funder differs from the union-valued carried cash session.
 -- No current membership rows are created: receipt-time union authority rules.
 INSERT INTO public.cash_participant_funding_receipts(id,table_id,account_entity_id,operation_kind,user_id,seat_id,
  recorded_at,occupancy_id,funding_club_id,funding_union_id,asset)
 SELECT gen_random_uuid(),cs.table_id,hp.player_id,'buyin',hp.player_id,ps.anchor_seat_id,
  started-interval '1 hour',gen_random_uuid(),fund,game_union,'chips'
 FROM public.lightning_hand_player hp JOIN public.lightning_pool_slot sl ON sl.id=hp.pool_slot_id
 JOIN public.lightning_pool_session ps ON ps.id=sl.pool_session_id
 JOIN public.cash_player_session cs ON cs.id=ps.cash_player_session_id WHERE hp.hand_id=c.hand_id;
 SELECT id,user_id,occupancy_id INTO STRICT first_receipt,first_user,first_occupancy
 FROM public.cash_participant_funding_receipts ORDER BY user_id LIMIT 1;
 -- Snapshot after fixture seeding; all following calls/negative subtransactions
 -- must preserve original evidence, actual money stacks and funding rows.
 baseline:=harness.funding_owner_original_rows();
 PERFORM set_config('enable_nestloop','off',true);
 corrected:=smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence);
 IF current_setting('enable_nestloop')<>'off' OR corrected-'participants'IS DISTINCT FROM r.evidence-'participants'
  OR EXISTS(SELECT FROM jsonb_array_elements(corrected->'participants')p WHERE p->>'earning_club_id'IS DISTINCT FROM fund::text)
 THEN RAISE EXCEPTION 'funding_owner_correct_owner_or_call_setting_changed';END IF;
 FOR person IN SELECT value FROM jsonb_array_elements(r.evidence->'participants')LOOP
  SELECT p INTO STRICT actual FROM jsonb_array_elements(corrected->'participants')p WHERE p->>'user_id'=person->>'user_id';
  IF actual-'earning_club_id'IS DISTINCT FROM person-'earning_club_id' THEN RAISE EXCEPTION 'funding_owner_changed_numeric_or_identity_evidence';END IF;
 END LOOP;
 SELECT k.evidence INTO STRICT actual FROM public.fn_union_pnl_linked_cash_outcomes(game_union,started-interval '1 day',started+interval '1 day')k
 WHERE k.table_id=r.table_id AND k.hand_number=r.hand_number;
 IF actual IS DISTINCT FROM corrected THEN RAISE EXCEPTION 'funding_owner_actual_linked_reader_did_not_project';END IF;
 PERFORM set_config('TimeZone','America/Los_Angeles',true);
 IF smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence)IS DISTINCT FROM corrected
  OR current_setting('TimeZone')<>'America/Los_Angeles' OR current_setting('enable_nestloop')<>'off'
 THEN RAISE EXCEPTION 'funding_owner_timezone_or_setting_not_restored';END IF;
 PERFORM set_config('TimeZone','UTC',true);

 -- Carried stack with no matching anchor still uses its original buy-in.
 BEGIN
  UPDATE public.cash_participant_funding_receipts SET seat_id=gen_random_uuid(),table_id=gen_random_uuid()WHERE id=first_receipt;
  IF smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence)IS DISTINCT FROM corrected
  THEN RAISE EXCEPTION 'funding_owner_carried_stack_fallback_failed';END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 -- A later receipt cannot rewrite ownership at the original hand start.
 BEGIN
  UPDATE public.cash_participant_funding_receipts SET recorded_at=started+interval '1 second'WHERE id=first_receipt;
  actual:=smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence);
  IF (SELECT p->>'earning_club_id'FROM jsonb_array_elements(actual->'participants')p WHERE p->>'user_id'=first_user::text)IS DISTINCT FROM game_union::text
  THEN RAISE EXCEPTION 'funding_owner_used_future_receipt';END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 -- More than one original funder, a foreign union or a foreign asset do not
 -- invent ownership. Preserve the previously recorded session club instead.
 FOREACH role_name IN ARRAY ARRAY['ambiguous','foreign_union','foreign_asset']LOOP
  BEGIN
   IF role_name='ambiguous' THEN
    INSERT INTO public.cash_participant_funding_receipts(id,table_id,account_entity_id,operation_kind,user_id,seat_id,recorded_at,occupancy_id,funding_club_id,funding_union_id,asset) SELECT gen_random_uuid(),table_id,account_entity_id,operation_kind,user_id,seat_id,
     recorded_at,occupancy_id,other,funding_union_id,asset FROM public.cash_participant_funding_receipts WHERE id=first_receipt;
   ELSIF role_name='foreign_union' THEN UPDATE public.cash_participant_funding_receipts SET funding_union_id=other WHERE id=first_receipt;
   ELSE UPDATE public.cash_participant_funding_receipts SET asset='diamonds'WHERE id=first_receipt;END IF;
   actual:=smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence);
   IF (SELECT p->>'earning_club_id'FROM jsonb_array_elements(actual->'participants')p WHERE p->>'user_id'=first_user::text)IS DISTINCT FROM game_union::text
   THEN RAISE EXCEPTION 'funding_owner_unproven_original_funder_accepted:%',role_name;END IF;
   RAISE EXCEPTION USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 END LOOP;

 -- Malformed original custody is refused; local planner settings restore on
 -- exceptions as well as ordinary returns. No retained source row is changed.
 FOREACH role_name IN ARRAY ARRAY['pool_slot_id','pool_session_id']LOOP
  SELECT value INTO person FROM jsonb_array_elements(r.evidence->'participants')p WHERE p->>'user_id'=first_user::text;
  bad:=jsonb_set(person,ARRAY[role_name],to_jsonb(other));
  SELECT jsonb_set(r.evidence,'{participants}',jsonb_agg(CASE WHEN p->>'user_id'=first_user::text THEN bad ELSE p END))INTO bad
  FROM jsonb_array_elements(r.evidence->'participants')p;
  refused:=false;
  BEGIN PERFORM smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,bad);
  EXCEPTION WHEN no_data_found THEN refused:=true;END;
  IF NOT refused OR current_setting('enable_nestloop')<>'off' THEN RAISE EXCEPTION 'funding_owner_bad_custody_or_error_setting:%',role_name;END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role']LOOP
  EXECUTE format('SET LOCAL ROLE %I',role_name);
  BEGIN PERFORM smarter_private.original_lightning_funding_owner_evidence(NULL,NULL,NULL,NULL);
   RAISE EXCEPTION 'funding_owner_private_helper_exposed:%',role_name;
  EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;END;
  RESET ROLE;
 END LOOP;
 IF denied<>3 OR harness.funding_owner_original_rows()IS DISTINCT FROM baseline
 THEN RAISE EXCEPTION 'funding_owner_access_or_immutable_originals_changed';END IF;
 -- Existing private games keep their exact retained evidence bytes.
 FOR r IN SELECT q.*FROM public.union_pnl_cash_outcome_link_resolutions q JOIN public.lightning_hand h ON h.hand_history_id=q.hand_id
  JOIN harness.pnl_cases k ON k.hand_id=h.hand_id WHERE k.label IN('historical','live','refused_live')LOOP
  IF smarter_private.original_lightning_funding_owner_evidence(r.table_id,r.hand_number,r.game_scope,r.evidence)IS DISTINCT FROM r.evidence
  THEN RAISE EXCEPTION 'funding_owner_private_original_changed';END IF;
 END LOOP;
END $funding_owner$;
\echo 'PASS actual funding owner: public retained-link projection, original buy-in/carried fallback, future/ambiguous/foreign refusals, stable numbers/raw originals, timezone/planner restoration and private ACL'
