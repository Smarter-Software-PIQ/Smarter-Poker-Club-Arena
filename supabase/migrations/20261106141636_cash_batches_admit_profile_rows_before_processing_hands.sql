-- A cash batch admits profile rows before processing any hand.
-- Oct26 original deadlock: batch profile B -> A, tournament payout A -> B.
-- Existing player-stats advisory keys do not cover the payout writer.
-- Preserve original item identity, amounts, caller cursor and bounded budgets.
-- Busy profiles defer whole original items before writes; unrelated items proceed.
-- Source cohorts are rechecked under the original immutable earning hand key.
-- No compensating payment, repair job, timer, table DDL or new publisher.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_credit_agent_commissions_batch(jsonb)'::regprocedure)) = '7d3bbd947914c70ef909a085c8fb5dfc')
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_retry_cash_accounting_sources(integer)'::regprocedure)) = '0b9443c47523295afafcb657020bdc21')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $install$
DECLARE sig regprocedure:='public.fn_credit_agent_commissions_batch(jsonb)'::regprocedure;
 original_meta jsonb;new_text text:=$candidate$CREATE OR REPLACE FUNCTION public.fn_credit_agent_commissions_batch(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE it jsonb;r jsonb;receipts jsonb:='[]';record_id uuid;v_ok int:=0;v_failed int:=0;v_blocked int:=0;first_error text;v_gate uuid;
 v_n bigint;v_clubs uuid[];v_sets jsonb:='[]';v_need uuid[]:='{}';v_held uuid[]:='{}';v_deferred jsonb:='[]';v_lock_timeout text;v_wait_until timestamptz;
 v_users uuid[];v_usets jsonb:='[]';v_need_users uuid[]:='{}';v_held_users uuid[]:='{}';v_user uuid;
 v_profile_users uuid[]:='{}';v_hand uuid;
 v_call_deadline timestamptz;v_item_lock_ms bigint;v_session_lock_timeout text;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'cash_source_not_authorised' USING ERRCODE='42501'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>2000 THEN
  RETURN jsonb_build_object('ok',0,'failed',0,'error','p_items must be a jsonb array of at most 2000 items'); END IF;
 -- THE CALL FITS THE ENGINE'S PATIENCE (2026-10-19, 20261019214727). The engine
 -- gives a call 15 s and then abandons it (the database finishes it anyway and
 -- the page halts). Inside an item every lock wait used the session's 8 s
 -- lock_timeout, so two items behind one long-held row - 2026-10-19 17:02, a
 -- union_wallets/profiles holder of ~45 s after the break - made a 16.1 s call.
 -- Each item now waits at most 2 s for a lock (never longer than the session
 -- allows) and the call starts no item after 8 s; such an item is deferred
 -- exactly like one whose keys are not held. A blocked item is still refused
 -- durably (its retry work is unchanged), only sooner.
 v_session_lock_timeout:=current_setting('lock_timeout');
 v_item_lock_ms:=CASE WHEN extract(epoch FROM v_session_lock_timeout::interval)>0
  THEN LEAST(2000,ceil(extract(epoch FROM v_session_lock_timeout::interval)*1000)::bigint) ELSE 2000 END;
 v_call_deadline:=clock_timestamp()+interval '8 seconds';
 -- EVERY COMMISSION KEY IN CLUB ORDER BEFORE THE FIRST ITEM; AN ITEM WHOSE KEYS
 -- ARE NOT ALL HELD WAITS FOR THE NEXT CALL (2026-10-19). This batch is one
 -- transaction over many hands and keeps each item's rows and keys to its end.
 -- An item's commission rows take the 'agent-commission:<club>' key of each
 -- club its rake is attributed in (trg_agent_commission_rollup_insert), and a
 -- tournament finish takes the same keys in club order. Taking them item by
 -- item, in page order, held a later club while waiting for an earlier one:
 -- 40P01 against a finish (2026-10-19 07:28:34). So the keys every item needs
 -- are taken here, in club order: a free key at once, a busy one waited for
 -- within one 1 s budget while holding only lower keys, which no finish waits
 -- for. A key not granted is skipped (below) and never fails the batch whole
 -- (2026-10-01 00:07:30). An item whose clubs are not all held is not run and
 -- not refused: it writes nothing and is returned in 'deferred', and the
 -- settler submits it again before its cursor may pass it.
 FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_clubs:=ARRAY(SELECT DISTINCT c.club_id FROM (
    SELECT a.club_id FROM public.rake_attributions a
     WHERE a.rake_record_id=CASE WHEN it->>'source_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN CASE it->>'source_type' WHEN 'cash_rake_record' THEN (it->>'source_id')::uuid
       WHEN 'rake_settlement' THEN (SELECT h.id FROM public.rake_records h WHERE h.hand_id=(it->>'source_id')::uuid ORDER BY h.id LIMIT 1)
      END END
    UNION ALL
    SELECT CASE WHEN it->>'club_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (it->>'club_id')::uuid END
     WHERE NOT COALESCE(it->>'source_type' IN('cash_rake_record','rake_settlement'),false)
   ) c WHERE c.club_id IS NOT NULL ORDER BY c.club_id);
  v_sets:=v_sets||jsonb_build_array(to_jsonb(v_clubs));
  v_need:=v_need||v_clubs;
  -- The players whose player_stats rows (and, through
  -- trg_sync_profile_total_hands, profile rows) the item writes: the
  -- contributors of its rake, as fn_accounting_cash_commission_plan reads them.
  v_users:=ARRAY(SELECT DISTINCT a.player_id FROM public.rake_attributions a
    WHERE a.player_id IS NOT NULL AND a.rake_record_id=CASE WHEN it->>'source_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN CASE it->>'source_type' WHEN 'cash_rake_record' THEN (it->>'source_id')::uuid
       WHEN 'rake_settlement' THEN (SELECT h.id FROM public.rake_records h WHERE h.hand_id=(it->>'source_id')::uuid ORDER BY h.id LIMIT 1)
      END END ORDER BY a.player_id);
  v_usets:=v_usets||jsonb_build_array(to_jsonb(v_users));
 END LOOP;
 v_need:=ARRAY(SELECT DISTINCT g FROM unnest(v_need) g ORDER BY g);
 -- A BUSY KEY IS SKIPPED, NOT THE END OF THE WALK (2026-10-19, 20261019171753).
 -- Ending the walk at the first busy key deferred every item behind it in club
 -- order, including items that need none of the busy clubs: one busy Midway key
 -- (the lowest uuids) deferred every Lightning item, every call. The walk now
 -- goes on past a busy key. Keys are still only ever waited for in club order,
 -- and only for a key above every key already held, so the gaps keep one total
 -- order; the waits share one 1 s budget per call.
 v_wait_until:=clock_timestamp()+interval '1 second';
 FOREACH v_gate IN ARRAY v_need LOOP
  IF pg_try_advisory_xact_lock(hashtextextended('agent-commission:'||v_gate::text,0)) THEN
   v_held:=v_held||v_gate;
  ELSIF clock_timestamp()<v_wait_until THEN
   BEGIN
    v_lock_timeout:=current_setting('lock_timeout');
    PERFORM set_config('lock_timeout',
     GREATEST(1,ceil(extract(epoch FROM v_wait_until-clock_timestamp())*1000))::bigint::text||'ms',true);
    PERFORM pg_advisory_xact_lock(hashtextextended('agent-commission:'||v_gate::text,0));
    PERFORM set_config('lock_timeout',v_lock_timeout,true);
    v_held:=v_held||v_gate;
   EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    NULL;
   END;
  END IF;
 END LOOP;
 -- EVERY PLAYER KEY IN PLAYER ORDER, AFTER THE CLUB KEYS AND BEFORE THE FIRST
 -- ITEM (2026-10-19, 20261019194410). Each item writes its contributors'
 -- player_stats rows (apply_rakeback_player_stats) and, through
 -- trg_sync_profile_total_hands, their profile rows, and this transaction keeps
 -- them to its end. Item by item that is page order: the hand of player b, then
 -- the hand of player a. The hand projection
 -- (fn_project_hand_side_effects_after_post_commit_20260908) writes the same rows
 -- for a hand's players in player order, a then b, so each held one and asked
 -- for the other: 79 of the 95 deadlocks in the six hours to 11:00 UTC on
 -- 2026-10-19. Both now take 'player-stats-user:<player>' for every player whose
 -- rows they write, in player order, before the first such row; a row is only
 -- ever written under its player's key, so neither can hold a row the other is
 -- waiting for. Only the items whose club keys are all held need theirs. The
 -- walk is the club walk's: a busy key is waited for only while the same 1 s
 -- budget lasts, holding only lower player keys (a projection holding a key
 -- waits for no lower one), and a key not granted is skipped; an item whose
 -- players are not all held is deferred exactly as for a club key.
 FOR v_n IN 1..jsonb_array_length(p_items) LOOP
  IF ARRAY(SELECT g::uuid FROM jsonb_array_elements_text(v_sets->(v_n::int-1)) g)<@v_held THEN
   v_need_users:=v_need_users||ARRAY(SELECT g::uuid FROM jsonb_array_elements_text(v_usets->(v_n::int-1)) g);
  END IF;
 END LOOP;
 v_need_users:=ARRAY(SELECT DISTINCT g FROM unnest(v_need_users) g ORDER BY g);
 FOREACH v_user IN ARRAY v_need_users LOOP
  IF pg_try_advisory_xact_lock(hashtextextended('player-stats-user:'||v_user::text,0)) THEN
   v_held_users:=v_held_users||v_user;
  ELSIF clock_timestamp()<v_wait_until THEN
   BEGIN
    v_lock_timeout:=current_setting('lock_timeout');
    PERFORM set_config('lock_timeout',
     GREATEST(1,ceil(extract(epoch FROM v_wait_until-clock_timestamp())*1000))::bigint::text||'ms',true);
    PERFORM pg_advisory_xact_lock(hashtextextended('player-stats-user:'||v_user::text,0));
    PERFORM set_config('lock_timeout',v_lock_timeout,true);
    v_held_users:=v_held_users||v_user;
   EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    NULL;
   END;
  END IF;
 END LOOP;
 -- Admit profile rows before any item can retain one while asking for another.
 -- Payouts own these rows without the player-stats advisory keys. Never wait
 -- for a busy profile while retaining another: leave its whole item with the
 -- original caller through the existing deferred contract. Missing profiles
 -- keep the existing stats-only behavior; this does not create a wallet.
 FOREACH v_user IN ARRAY v_held_users LOOP
  BEGIN
   PERFORM 1 FROM public.profiles WHERE id=v_user FOR NO KEY UPDATE NOWAIT;
   v_profile_users:=v_profile_users||v_user;
  EXCEPTION WHEN lock_not_available THEN
   NULL;
  END;
 END LOOP;
 FOR it,v_n IN SELECT value,ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY LOOP
  v_clubs:=ARRAY(SELECT g::uuid FROM jsonb_array_elements_text(v_sets->(v_n::int-1)) g);
  v_users:=ARRAY(SELECT g::uuid FROM jsonb_array_elements_text(v_usets->(v_n::int-1)) g);
  IF NOT v_clubs<@v_held OR NOT v_users<@v_profile_users THEN
   v_deferred:=v_deferred||jsonb_build_array(it->'source_id');
   CONTINUE;
  END IF;
  IF clock_timestamp()>=v_call_deadline THEN
   v_deferred:=v_deferred||jsonb_build_array(it->'source_id');
   CONTINUE;
  END IF;
  PERFORM set_config('lock_timeout',LEAST(v_item_lock_ms,
   GREATEST(1,ceil(extract(epoch FROM v_call_deadline-clock_timestamp())*1000)::bigint))::text||'ms',true);
  BEGIN
   IF it->>'source_type' IN('cash_rake_record','rake_settlement') THEN
    IF it->>'source_type'='cash_rake_record' THEN record_id:=(it->>'source_id')::uuid;
    ELSE
     SELECT id INTO STRICT record_id FROM public.rake_records WHERE hand_id=(it->>'source_id')::uuid;
    END IF;
    -- Source edits share this original hand key with the accrual owner.
    -- Revalidate the contributor cohort under that key, before any earning,
    -- counter or profile write; an expanded source must not use an unowned row.
    SELECT hand_id INTO v_hand FROM public.rake_records WHERE id=record_id;
    IF v_hand IS NOT NULL THEN
     PERFORM pg_advisory_xact_lock(hashtextextended('accounting_cash_hand:'||v_hand::text,0));
     IF NOT EXISTS(SELECT 1 FROM public.rake_records WHERE id=record_id AND hand_id=v_hand)
      OR EXISTS(SELECT 1 FROM public.rake_attributions WHERE rake_record_id=record_id
       AND player_id IS NOT NULL AND NOT player_id=ANY(v_profile_users)) THEN
      v_deferred:=v_deferred||jsonb_build_array(it->'source_id');
      CONTINUE;
     END IF;
    END IF;
    IF it->>'source_type'='rake_settlement' THEN
     -- Preserve legacy scope validation against the now-owned current source.
     IF NOT EXISTS(SELECT 1 FROM public.rake_attributions WHERE rake_record_id=record_id
      AND player_id=(it->>'user_id')::uuid AND club_id=(it->>'club_id')::uuid
      AND weighted_rake_credit=(it->>'rake_credit')::numeric) THEN
      RAISE EXCEPTION 'cash_source_legacy_input_not_proven' USING ERRCODE='23514'; END IF;
    END IF;
    r:=public.fn_process_cash_accounting_source(record_id);receipts:=receipts||jsonb_build_array(r);
    IF r->>'status'='accrued' THEN v_ok:=v_ok+1;
    ELSE v_failed:=v_failed+1;v_blocked:=v_blocked+1;first_error:=COALESCE(first_error,r->>'reason'); END IF;
   ELSE
    PERFORM public.credit_agent_commission_from_rake((it->>'user_id')::uuid,(it->>'club_id')::uuid,
     COALESCE((it->>'rake_credit')::numeric,0),it->>'source_type',NULLIF(it->>'source_id','')::uuid,it->>'notes');
    v_ok:=v_ok+1;
   END IF;
  EXCEPTION WHEN OTHERS THEN v_failed:=v_failed+1;first_error:=COALESCE(first_error,SQLERRM);
  END;
 END LOOP;
 PERFORM set_config('lock_timeout',v_session_lock_timeout,true);
 RETURN jsonb_build_object('receipt_version',3,'ok',v_ok,'failed',v_failed,'blocked',v_blocked,'first_error',first_error,'receipts',receipts,
  'deferred',v_deferred);
END $function$
$candidate$;
BEGIN
 IF md5(pg_get_functiondef(sig))<>'1c9d9ff9cfb2803f05223c703f61f09b' THEN
  RAISE EXCEPTION 'cash profile admission preimage changed';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,
  'config',proconfig,'security_definer',prosecdef) INTO original_meta FROM pg_proc WHERE oid=sig;
 IF original_meta<>jsonb_build_object('owner','postgres','acl','{postgres=X/postgres,service_role=X/postgres}',
  'config',ARRAY['search_path=public','statement_timeout=300s'],'security_definer',true) THEN
  RAISE EXCEPTION 'cash profile admission metadata changed';
 END IF;
 IF md5(pg_get_functiondef('public.fn_process_cash_accounting_source(uuid)'::regprocedure))<>'460e4b0a936b41246548cb0a9efc9f7f' THEN
  RAISE EXCEPTION 'cash profile admission source owner changed';
 END IF;
 IF md5(pg_get_functiondef('public.fn_accounting_cash_source_immutable()'::regprocedure))<>'0d79f2823f390072ddab8abfa8a5263f'
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.rake_attributions'::regclass
   AND tgname='accounting_cash_source_immutable' AND tgenabled='O'
   AND pg_get_triggerdef(oid)='CREATE TRIGGER accounting_cash_source_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.rake_attributions FOR EACH ROW EXECUTE FUNCTION fn_accounting_cash_source_immutable()')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.rake_records'::regclass
   AND tgname='accounting_cash_source_immutable' AND tgenabled='O'
   AND pg_get_triggerdef(oid)='CREATE TRIGGER accounting_cash_source_immutable BEFORE DELETE OR UPDATE ON public.rake_records FOR EACH ROW EXECUTE FUNCTION fn_accounting_cash_source_immutable()') THEN
  RAISE EXCEPTION 'cash profile admission source mutation authority changed';
 END IF;
 EXECUTE new_text;
 -- Restate the verified existing ACL for static authorization checks.
 REVOKE ALL ON FUNCTION public.fn_credit_agent_commissions_batch(jsonb) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.fn_credit_agent_commissions_batch(jsonb) TO service_role;
 IF pg_get_functiondef(sig)<>new_text OR md5(pg_get_functiondef(sig))<>'7d3bbd947914c70ef909a085c8fb5dfc' THEN
  RAISE EXCEPTION 'cash profile admission postimage differs';
 END IF;
 IF (SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,
  'config',proconfig,'security_definer',prosecdef) FROM pg_proc WHERE oid=sig)<>original_meta THEN
  RAISE EXCEPTION 'cash profile admission metadata moved';
 END IF;
END $install$;
DO $retry_install$
DECLARE sig regprocedure:='public.fn_retry_cash_accounting_sources(integer)'::regprocedure;
 original_meta jsonb;new_text text:=$retry_candidate$CREATE OR REPLACE FUNCTION public.fn_retry_cash_accounting_sources(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE r jsonb;receipts jsonb:='[]';v_ok int:=0;v_blocked int:=0;v_failed int:=0;first_error text;v_parked bigint:=0;v_gate uuid;
 v_due uuid[];v_id uuid;v_clubs uuid[];v_need uuid[];v_held uuid[]:='{}';v_deferred jsonb:='[]';v_lock_timeout text;v_wait_until timestamptz;
 v_users uuid[];v_user uuid;v_profile_users uuid[]:='{}';v_hand uuid;
 v_call_deadline timestamptz;v_item_lock_ms bigint;v_session_lock_timeout text;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'cash_source_not_authorised' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'invalid_cash_retry_limit' USING ERRCODE='22023'; END IF;
 -- THE CALL FITS THE ENGINE'S PATIENCE (2026-10-19, 20261019214727). The engine
 -- gives a call 15 s and then abandons it (the database finishes it anyway and
 -- the page halts). Inside an item every lock wait used the session's 8 s
 -- lock_timeout, so two items behind one long-held row - 2026-10-19 17:02, a
 -- union_wallets/profiles holder of ~45 s after the break - made a 16.1 s call.
 -- Each item now waits at most 2 s for a lock (never longer than the session
 -- allows) and the call starts no item after 8 s; such an item is deferred
 -- exactly like one whose keys are not held. A blocked item is still refused
 -- durably (its retry work is unchanged), only sooner.
 v_session_lock_timeout:=current_setting('lock_timeout');
 v_item_lock_ms:=CASE WHEN extract(epoch FROM v_session_lock_timeout::interval)>0
  THEN LEAST(2000,ceil(extract(epoch FROM v_session_lock_timeout::interval)*1000)::bigint) ELSE 2000 END;
 v_call_deadline:=clock_timestamp()+interval '8 seconds';
 -- EVERY COMMISSION KEY IN CLUB ORDER BEFORE THE FIRST SOURCE (2026-10-19), as
 -- fn_credit_agent_commissions_batch takes them: this retry is one transaction
 -- over many sources too. The due sources are chosen once; the keys of every
 -- club they are attributed in are taken in club order, a busy one waited for
 -- within one 1 s budget while holding only lower keys; a key not granted is
 -- skipped (below).
 -- A source whose clubs are not all held is not run: its blocked work row is
 -- left exactly as it is (no receipt, no attempt), it is returned in
 -- 'deferred', and it is among the first due sources again next cycle.
 -- A DEFERRED HEAD NEVER HOLDS THE QUEUE (2026-10-19, 20261019171753). The call
 -- reads a window of eight times p_limit due sources (at most 200), in the same
 -- order, and runs up to p_limit of those whose keys it holds. Before, it read
 -- exactly p_limit: when all of them waited on one busy key, the call ran
 -- nothing, the same sources came back first next call, and nothing behind
 -- them was ever reached.
 -- THE FEWEST REFUSALS GO FIRST (20261019102410). Oldest-due-first let a
 -- burst of sources still waiting on missing evidence hold every slot of
 -- every cycle while a source refused once by a lock waited a day behind it.
 v_due:=ARRAY(SELECT s.rake_record_id FROM public.accounting_cash_source_work s
  WHERE s.status='blocked' AND s.next_attempt_at<=clock_timestamp()
  ORDER BY s.attempts,s.next_attempt_at,s.rake_record_id LIMIT LEAST(200,p_limit*8));
 v_need:=ARRAY(SELECT DISTINCT a.club_id FROM public.rake_attributions a
  WHERE a.rake_record_id=ANY(v_due) AND a.club_id IS NOT NULL ORDER BY a.club_id);
 -- A BUSY KEY IS SKIPPED, NOT THE END OF THE WALK (2026-10-19, 20261019171753).
 -- Ending the walk at the first busy key deferred every item behind it in club
 -- order, including items that need none of the busy clubs: one busy Midway key
 -- (the lowest uuids) deferred every Lightning item, every call. The walk now
 -- goes on past a busy key. Keys are still only ever waited for in club order,
 -- and only for a key above every key already held, so the gaps keep one total
 -- order; the waits share one 1 s budget per call.
 v_wait_until:=clock_timestamp()+interval '1 second';
 FOREACH v_gate IN ARRAY v_need LOOP
  IF pg_try_advisory_xact_lock(hashtextextended('agent-commission:'||v_gate::text,0)) THEN
   v_held:=v_held||v_gate;
  ELSIF clock_timestamp()<v_wait_until THEN
   BEGIN
    v_lock_timeout:=current_setting('lock_timeout');
    PERFORM set_config('lock_timeout',
     GREATEST(1,ceil(extract(epoch FROM v_wait_until-clock_timestamp())*1000))::bigint::text||'ms',true);
    PERFORM pg_advisory_xact_lock(hashtextextended('agent-commission:'||v_gate::text,0));
    PERFORM set_config('lock_timeout',v_lock_timeout,true);
    v_held:=v_held||v_gate;
   EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    NULL;
   END;
  END IF;
 END LOOP;
 -- Admit ordered player keys and profile rows before retaining any item write.
 -- Wallet writers do not share player keys; neither admission may wait while
 -- holding another profile. Busy sources keep their original due work row.
 v_users:=ARRAY(SELECT DISTINCT a.player_id FROM public.rake_attributions a
  WHERE a.rake_record_id=ANY(v_due) AND a.player_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.rake_attributions b WHERE b.rake_record_id=a.rake_record_id
    AND b.club_id IS NOT NULL AND NOT b.club_id=ANY(v_held)) ORDER BY a.player_id);
 FOREACH v_user IN ARRAY v_users LOOP
  IF pg_try_advisory_xact_lock(hashtextextended('player-stats-user:'||v_user::text,0)) THEN
   BEGIN
    PERFORM 1 FROM public.profiles WHERE id=v_user FOR NO KEY UPDATE NOWAIT;
    v_profile_users:=v_profile_users||v_user;
   EXCEPTION WHEN lock_not_available THEN NULL;
   END;
  END IF;
 END LOOP;
 -- Do not lock work rows here: all callers acquire the original hand lock
 -- first. SKIP LOCKED on work would invert that order against direct callers.
 FOREACH v_id IN ARRAY v_due LOOP
  EXIT WHEN v_ok+v_blocked+v_failed>=p_limit;
  v_clubs:=ARRAY(SELECT DISTINCT a.club_id FROM public.rake_attributions a
   WHERE a.rake_record_id=v_id AND a.club_id IS NOT NULL ORDER BY a.club_id);
  IF NOT v_clubs<@v_held OR EXISTS(SELECT 1 FROM public.rake_attributions WHERE rake_record_id=v_id
   AND player_id IS NOT NULL AND NOT player_id=ANY(v_profile_users)) THEN
   v_deferred:=v_deferred||jsonb_build_array(v_id::text);
   CONTINUE;
  END IF;
  IF clock_timestamp()>=v_call_deadline THEN
   v_deferred:=v_deferred||jsonb_build_array(v_id::text);
   CONTINUE;
  END IF;
  PERFORM set_config('lock_timeout',LEAST(v_item_lock_ms,
   GREATEST(1,ceil(extract(epoch FROM v_call_deadline-clock_timestamp())*1000)::bigint))::text||'ms',true);
  BEGIN
   SELECT hand_id INTO v_hand FROM public.rake_records WHERE id=v_id;
   IF v_hand IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('accounting_cash_hand:'||v_hand::text,0));
    IF NOT EXISTS(SELECT 1 FROM public.rake_records WHERE id=v_id AND hand_id=v_hand)
     OR EXISTS(SELECT 1 FROM public.rake_attributions WHERE rake_record_id=v_id
      AND player_id IS NOT NULL AND NOT player_id=ANY(v_profile_users)) THEN
     v_deferred:=v_deferred||jsonb_build_array(v_id::text);
     CONTINUE;
    END IF;
   END IF;
   r:=public.fn_process_cash_accounting_source(v_id);receipts:=receipts||jsonb_build_array(r);
   IF r->>'status'='accrued' THEN v_ok:=v_ok+1; ELSE v_blocked:=v_blocked+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_failed:=v_failed+1;first_error:=COALESCE(first_error,SQLERRM);END;
 END LOOP;
 -- Deferrals are reported within the bound the caller asked for (receipts plus
 -- deferrals never exceed p_limit); a deferred source not reported is left
 -- exactly as it is, like every deferred source.
 v_deferred:=COALESCE((SELECT jsonb_agg(x.e ORDER BY x.n) FROM jsonb_array_elements(v_deferred) WITH ORDINALITY x(e,n)
  WHERE x.n<=p_limit-(v_ok+v_blocked+v_failed)),'[]'::jsonb);
 PERFORM set_config('lock_timeout',v_session_lock_timeout,true);
 SELECT count(*) INTO v_parked FROM public.accounting_cash_source_work
  WHERE status='blocked' AND next_attempt_at='infinity'::timestamptz;
 RETURN jsonb_build_object('receipt_version',3,'ok',v_ok,'blocked',v_blocked,'failed',v_failed+v_blocked,'terminal_parked',v_parked,
  'first_error',first_error,'receipts',receipts,'deferred',v_deferred);
END $function$
$retry_candidate$;
BEGIN
 IF md5(pg_get_functiondef(sig))<>'df10ba64229df0c99918dad77f39aec7' THEN
  RAISE EXCEPTION 'cash retry profile admission preimage changed';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,
  'config',proconfig,'security_definer',prosecdef) INTO original_meta FROM pg_proc WHERE oid=sig;
 IF original_meta<>jsonb_build_object('owner','postgres','acl','{postgres=X/postgres,service_role=X/postgres}',
  'config',ARRAY['search_path=public','statement_timeout=300s'],'security_definer',true) THEN
  RAISE EXCEPTION 'cash retry profile admission metadata changed';
 END IF;
 EXECUTE new_text;
 REVOKE ALL ON FUNCTION public.fn_retry_cash_accounting_sources(integer) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.fn_retry_cash_accounting_sources(integer) TO service_role;
 IF pg_get_functiondef(sig)<>new_text OR md5(pg_get_functiondef(sig))<>'0b9443c47523295afafcb657020bdc21' THEN
  RAISE EXCEPTION 'cash retry profile admission postimage differs';
 END IF;
 IF (SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,
  'config',proconfig,'security_definer',prosecdef) FROM pg_proc WHERE oid=sig)<>original_meta THEN
  RAISE EXCEPTION 'cash retry profile admission metadata moved';
 END IF;
END $retry_install$;
COMMIT;
