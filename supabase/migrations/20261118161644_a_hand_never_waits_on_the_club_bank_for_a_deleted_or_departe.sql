-- 20261118161644_a_hand_never_waits_on_the_club_bank_for_a_deleted_or_departe.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A HAND NEVER WAITS ON THE CLUB BANK FOR A DELETED OR DEPARTED WALLET
-- (incident 075013fd, lane H1; part 1 of 2, installs on merge, no table lock)
--
-- After 20261118160106 taught the hand-path reader that an UPDATE OF trigger
-- fires only on the columns an UPDATE SETs, five shared-row entries remained
-- on the cash hand's path in this lane, and they are REAL. Read on production
-- 2026-11-18:
--
--   fn_ca_settle_hand_stacks_absolute (inside fn_ca_commit_hand_settlement)
--   credits a seat that left mid-hand to its member wallet
--   (club_members.chip_balance), as do atomic_credit_wallet_and_log and the
--   promo release in the post-commit envelope. Two AFTER UPDATE OF chip_balance
--   triggers on club_members then run inside the hand's transaction:
--
--   zzzz_deleted_member_credit -> fn_ca_deleted_wallet_credit ->
--     fn_ca_deleted_wallet_bank_return: for a deleted account, takes the club
--     bank row (clubs) FOR NO KEY UPDATE under the function's own
--     lock_timeout of 4 s, then writes clubs.chip_treasury. A busy bank held
--     the hand up to 4 s (hand-gap ruling: under 2 s), then failed it.
--   zzzz_horse_split_late_credit_returns_to_bank ->
--     fn_ca_horse_split_return_late_credit: for a split-departed horse record
--     (up to 23 such records held cash seats at measurement), takes the club
--     bank row FOR UPDATE under a 200 ms wait. FOR UPDATE also queued behind
--     every FOR KEY SHARE an insert referencing the club holds.
--   Either bank write then fired trg_union_totals_follow_club_counts, a
--   statement trigger on EVERY clubs UPDATE, into fn_apply_union_ladder
--   (part 2, 20261118161703).
--
-- THE FIX, AT THE SOURCE (this file):
--   1. fn_ca_deleted_wallet_bank_return_nowait (new) is the return's money
--      logic byte for byte, with the bank row taken NOWAIT.
--      fn_ca_deleted_wallet_bank_return keeps its signature, its 4 s wait and
--      every caller (account deletion, the weekly commission and rakeback
--      stages, the explicit returns): it takes the same rows in the same
--      order as before and calls the body, whose NOWAIT its own lock answers.
--   2. NEVER WAITS, NEVER STRANDS. The wallet-credit trigger and the horse
--      split return take the bank row NOWAIT. Inside a hand (the settlement
--      door's late-seat credit, or the post-commit envelope, named by
--      fn_ca_hand_context_table) a busy bank stores the return in
--      hand_wallet_return_pending for that table - the instruction, not an
--      amount: the chips stay in the member's wallet, journaled as credited.
--      The table's own continuation banks it with
--      fn_ca_bank_pending_wallet_returns (created here; wired into the
--      projection pass by 20261118191855, its own migration as the
--      20261118155509 law requires) and ends its pass until it is banked, so
--      the outbox row of the hand that stored it cannot leave first.
--      fn_ca_post_commit_lag_watch (every minute) counts a stored return as
--      pending post-commit work of its table: older than 15 s it is critical.
--      Outside a hand the caller retries NOWAIT for the time it always waited
--      (4 s for a deleted wallet, then the same refusal; 200 ms for a horse,
--      then the 2026-11-03 fallback). No timer, no sweep (CLAUDE.md 10.12).
--   3. The horse return's body is fn_ca_horse_split_return_now (NO KEY UPDATE
--      NOWAIT on the bank: only chip_treasury changes), called by the trigger
--      and by the banker; the trigger's account-deletion sibling
--      fn_ca_deleted_profile_bank_return is created here for part 2.
--   4. fn_union_totals_follow_club_count_row (new, unused until part 2).
--
-- Behaviour for players is identical: every credit lands, every return to a
-- bank is the same Club Bank claim with the same ledger. The only difference
-- is WHEN a return to a busy bank happens: in the table's next post-commit
-- pass, instead of the hand waiting.
--
-- PRE-FLIGHT: refuses unless the four replaced bodies are the production
-- texts it was written against, md5-pinned below (texts in
-- scripts/ci/fixtures/hand-path-cash-lane/). No installed function pins those
-- md5s (searched production public+smarter_private 2026-11-18;
-- smarter_private.original_erased_cash_base_discharge pins OLDER bodies of the
-- two deleted-wallet functions and already disagrees with production).
-- Proof: scripts/ci/test-hand-path-cash-lane.py.
--
-- @live-proof: (to_regclass('public.hand_wallet_return_pending') IS NOT NULL AND to_regprocedure('public.fn_ca_bank_pending_wallet_returns(uuid,timestamptz)') IS NOT NULL AND strpos(pg_get_functiondef('public.fn_ca_post_commit_lag_watch()'::regprocedure), 'FROM hand_wallet_return_pending w') > 0 AND strpos(pg_get_functiondef('public.fn_ca_deleted_wallet_credit()'::regprocedure), 'fn_ca_deleted_wallet_return_or_defer(') > 0 AND strpos(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure), 'fn_ca_horse_split_return_now(') > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $h1_pre$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_deleted_wallet_bank_return(uuid,uuid,text)'))) IS DISTINCT FROM 'b8b056e0cd202d442da0133271814c06' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_ca_deleted_wallet_bank_return(uuid,uuid,text)' USING ERRCODE='55000';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_deleted_wallet_credit()'))) IS DISTINCT FROM '38381e35aa9804fb1e109c20855e4854' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_ca_deleted_wallet_credit()' USING ERRCODE='55000';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_horse_split_return_late_credit()'))) IS DISTINCT FROM 'b4d29a312a1d98b8a1b9c9ef7d0bb19b' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_ca_horse_split_return_late_credit()' USING ERRCODE='55000';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_post_commit_lag_watch()'))) IS DISTINCT FROM 'e58b975340e642f0e93fdda8eff89f02' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_ca_post_commit_lag_watch()' USING ERRCODE='55000';
 END IF;
END $h1_pre$;

INSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES
 ('fn_ca_deleted_wallet_bank_return_nowait', 'system',
  'Deleted-account lifecycle custody body (20261118161644): fn_ca_deleted_wallet_bank_return''s money logic unchanged, the club bank row taken NOWAIT. Called by the wallet-credit trigger (a refused bank defers the return, warning filed) and by fn_ca_deleted_wallet_bank_return after it has taken the same rows with its 4 s wait.'),
 ('fn_ca_horse_split_return_now', 'approved',
  'Horse club split late return (20261118161644): the body of fn_ca_horse_split_return_late_credit as a callable, bank row NOWAIT; called by that trigger and by fn_ca_bank_pending_wallet_returns from the table''s post-commit continuation. Same Club Bank claim, ledger and receipt.'),
 ('fn_ca_horse_split_return_late_credit', 'approved',
  'Horse club split (Dan 2026-11-03 05:27 CT): trigger that returns a credit landing on a split-departed horse record to that club''s bank in the same transaction, through a declared Club Bank claim; falls back to leaving the credit on the record.')
ON CONFLICT (proname) DO NOTHING;

-- A return a hand could not make because its club bank was busy: what to
-- return (the record's whole free balance at banking time), never an amount.
-- The chips stay in the member's wallet, journaled as credited, until the
-- table's own post-commit continuation banks them. No foreign key (CLAUDE.md
-- section 2 rule 7): it would lock tables and clubs.
CREATE TABLE public.hand_wallet_return_pending (
  table_id uuid NOT NULL,
  club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deleted_player_wallet', 'deleted_agent_wallet', 'horse_split_late_credit')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  PRIMARY KEY (table_id, club_id, user_id, kind)
);
ALTER TABLE public.hand_wallet_return_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hand_wallet_return_pending FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.hand_wallet_return_pending TO service_role;

CREATE FUNCTION public.fn_ca_deleted_wallet_bank_return_nowait(p_club uuid, p_user uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '4s'
AS $function$
DECLARE
 v_player numeric:=0; v_agent numeric:=0; v_bank numeric; v_owner uuid; v_reserved numeric:=0;
 v_op uuid; v_amount numeric; v_source text; v_key text; v_saved jsonb:='{}'::jsonb;
 v_keys text[]:=ARRAY['app.ledger_category','app.ledger_counterparty',
 'app.ledger_counterparty_entity','app.ledger_counterparty_label','app.ledger_settlement',
 'app.ledger_idempotency_key','app.ledger_correlation','app.ledger_tournament','app.cash_original_debit_ledger','app.ledger_autoskip_clubs',
 'app.ledger_autoskip_club_members','app.ledger_autoskip_agents','app.deleted_wallet_return_operation'];
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user AND status='deleted' FOR SHARE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('success',false,'reason','account_not_deleted');
 END IF;
 IF p_source NOT IN ('wallets','player_wallet','agent_wallet') OR p_source IS NULL THEN RAISE EXCEPTION 'unknown_deleted_wallet_source'; END IF;
 -- Agent-first for the explicit two-wallet lifecycle return. A live credit
 -- takes only its already-owned source row, never the other wallet.
 IF p_source IN ('wallets','agent_wallet') THEN
  SELECT greatest(coalesce(agent_wallet_balance,0),0) INTO v_agent
  FROM public.agents WHERE club_id=p_club AND user_id=p_user FOR NO KEY UPDATE;
 END IF;
 IF p_source IN ('wallets','player_wallet') THEN
  SELECT greatest(coalesce(chip_balance,0)-coalesce(held_chips,0)-coalesce(locked_chips,0),0)
  INTO v_player FROM public.club_members WHERE club_id=p_club AND user_id=p_user FOR NO KEY UPDATE;
 END IF;
 v_player:=coalesce(v_player,0); v_agent:=coalesce(v_agent,0);
 -- Published money owed to other players is not free money at account closure.
 -- The private reader locks existing periods NOWAIT and validates latest first.
 -- 20261022: a real agent pays its players' rakeback from its agent wallet,
 -- so published obligations are held back in the agent wallet first and only
 -- the part it cannot cover stays in the player wallet. reserved_rakeback is
 -- what this call held back from the wallet(s) it returns.
 IF v_player>0 OR v_agent>0 THEN
  v_reserved:=smarter_private.deleted_wallet_published_rakeback_reserve(p_club,p_user);
  IF p_source='player_wallet' THEN
   v_reserved:=greatest(v_reserved-COALESCE((SELECT greatest(coalesce(a.agent_wallet_balance,0),0) FROM public.agents a WHERE a.club_id=p_club AND a.user_id=p_user),0),0);
   v_player:=greatest(v_player-v_reserved,0);
  ELSIF p_source='agent_wallet' THEN
   v_agent:=greatest(v_agent-v_reserved,0);
  ELSE
   v_player:=greatest(v_player-greatest(v_reserved-v_agent,0),0);
   v_agent:=greatest(v_agent-v_reserved,0);
  END IF;
 END IF;
 SELECT chip_treasury,owner_id INTO v_bank,v_owner FROM public.clubs
 WHERE id=p_club AND asset='chips' AND (lifecycle_status='active' OR
    (lifecycle_status='retired' AND p_source IN ('player_wallet','agent_wallet')
     AND smarter_private.retired_club_owns_final_round(p_club,retired_at,ARRAY[3]))) FOR NO KEY UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'reason','not_active_chip_club'); END IF;
 IF v_player+v_agent=0 THEN RETURN jsonb_build_object('success',true,'amount',0,'player_chips',0,'agent_chips',0,'reserved_rakeback',v_reserved,'bank_after',v_bank); END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'platform_is_frozen'; END IF;
 FOREACH v_key IN ARRAY v_keys LOOP
  v_saved:=v_saved||jsonb_build_object(v_key,coalesce(current_setting(v_key,true),''));
 END LOOP;
 FOREACH v_source IN ARRAY ARRAY['player_wallet','agent_wallet'] LOOP
  v_amount:=CASE WHEN v_source='player_wallet' THEN v_player ELSE v_agent END;
  IF v_amount=0 THEN CONTINUE; END IF;
  v_op:=gen_random_uuid();
  PERFORM set_config('app.ledger_autoskip_club_members','',true);
  PERFORM set_config('app.ledger_autoskip_agents','',true);
  PERFORM public.fn_ca_declare_ledger('club_bank_claim','club_treasury',p_club,NULL,
   'deleted_account_bank_return:'||v_op,ARRAY['clubs']);
  PERFORM set_config('app.ledger_correlation',v_op::text,true);
  PERFORM set_config('app.ledger_settlement','',true);
  PERFORM set_config('app.ledger_tournament','',true);
  IF v_source='player_wallet' THEN
   UPDATE public.club_members SET chip_balance=chip_balance-v_amount,updated_at=now()
   WHERE club_id=p_club AND user_id=p_user;
  ELSE
   UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-v_amount,updated_at=now()
   WHERE club_id=p_club AND user_id=p_user;
  END IF;
  PERFORM set_config('app.deleted_wallet_return_operation',txid_current()::text||':'||v_op::text,true);
  UPDATE public.clubs SET chip_treasury=coalesce(chip_treasury,0)+v_amount,updated_at=now()
  WHERE id=p_club RETURNING chip_treasury INTO v_bank;
  INSERT INTO public.chip_transactions
   (club_id,from_user_id,to_user_id,amount,transaction_type,notes,metadata,balance_after)
  VALUES(p_club,p_user,v_owner,v_amount,'club_bank_claim','Deleted Account Chips Returned To Club Bank',
   jsonb_build_object('op_id',v_op,'source',v_source,'direction','into_bank',
    'reason','deleted_account','bank_after',v_bank)
    ||CASE WHEN public.fn_caller_is_engine() IS TRUE AND nullif(current_setting('app.accounting_routing_context',true),'') IS NOT NULL
      THEN jsonb_build_object('accounting_routing_context',current_setting('app.accounting_routing_context',true)) ELSE '{}'::jsonb END,v_bank);
 END LOOP;
 FOREACH v_key IN ARRAY v_keys LOOP PERFORM set_config(v_key,v_saved->>v_key,true); END LOOP;
 RETURN jsonb_build_object('success',true,'amount',v_player+v_agent,
  'player_chips',v_player,'agent_chips',v_agent,'reserved_rakeback',v_reserved,'bank_after',v_bank);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_deleted_wallet_bank_return(p_club uuid, p_user uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '4s'
AS $function$
BEGIN
 -- The rows the return moves, taken in the order it always took them, waiting
 -- as it always waited (lock_timeout 4s): profile, agent, member, club bank.
 -- The body then takes the bank row NOWAIT, which this transaction's own lock
 -- answers at once. Callers (account deletion, the weekly stages, explicit
 -- returns) see exactly the waits and answers they saw before 20261118161644.
 PERFORM 1 FROM public.profiles WHERE id=p_user AND status='deleted' FOR SHARE;
 IF FOUND AND p_source IN ('wallets','player_wallet','agent_wallet') THEN
  IF p_source IN ('wallets','agent_wallet') THEN
   PERFORM 1 FROM public.agents WHERE club_id=p_club AND user_id=p_user FOR NO KEY UPDATE;
  END IF;
  IF p_source IN ('wallets','player_wallet') THEN
   PERFORM 1 FROM public.club_members WHERE club_id=p_club AND user_id=p_user FOR NO KEY UPDATE;
  END IF;
  PERFORM 1 FROM public.clubs WHERE id=p_club AND asset='chips' FOR NO KEY UPDATE;
 END IF;
 RETURN public.fn_ca_deleted_wallet_bank_return_nowait(p_club,p_user,p_source);
END;
$function$;

CREATE FUNCTION public.fn_ca_deleted_profile_bank_return()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_club uuid;
BEGIN
 -- Account deletion (zzzz_deleted_profile_bank_return on profiles). The
 -- profiles branch of fn_ca_deleted_wallet_credit, moved here unchanged by
 -- 20261118161644 / 20261118161703 so the wallet-credit trigger a hand can
 -- fire carries no blocking club bank lock.
  -- Only clubs where the person holds free chips have anything to return.
  FOR v_club IN
   SELECT s.club_id FROM (
    SELECT m.club_id FROM public.club_members m WHERE m.user_id=NEW.id
      AND coalesce(m.chip_balance,0)-coalesce(m.held_chips,0)-coalesce(m.locked_chips,0) > 0
    UNION
    SELECT a.club_id FROM public.agents a WHERE a.user_id=NEW.id
      AND coalesce(a.agent_wallet_balance,0) > 0
   ) s ORDER BY s.club_id
  LOOP
   PERFORM public.fn_ca_deleted_wallet_bank_return(v_club,NEW.id,'wallets');
  END LOOP;
 RETURN NEW;
END;
$function$;

-- The table whose hand this transaction is committing, or NULL outside a
-- hand: the settlement door's late-seat credit (declared ledger key
-- late_seat_settle:..., counterparty the table's stack), or the post-commit
-- envelope (this backend holds the table's 'hand-post-commit:' lock while a
-- hand of it is pending). Read only when a club bank was busy.
CREATE FUNCTION public.fn_ca_hand_context_table()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_table uuid;
BEGIN
 IF current_setting('app.ledger_category', true) = 'settlement'
    AND current_setting('app.ledger_counterparty', true) = 'table_stack'
    AND current_setting('app.ledger_idempotency_key', true) LIKE 'late_seat_settle:%'
    AND current_setting('app.ledger_counterparty_entity', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RETURN current_setting('app.ledger_counterparty_entity', true)::uuid;
 END IF;
 SELECT c.table_id INTO v_table
   FROM public.hand_atomic_commits c
  WHERE c.post_commit_payload IS NOT NULL AND c.post_commit_completed_at IS NULL
    AND hashtextextended('hand-post-commit:' || c.table_id::text, 0) IN (
      SELECT (l.classid::bigint << 32) | l.objid::bigint
        FROM pg_catalog.pg_locks l
       WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.objsubid = 1 AND l.granted)
  ORDER BY c.hand_number
  LIMIT 1;
 RETURN v_table;
END;
$function$;

-- A deleted account's credited wallet goes back to its club bank now; the bank
-- row is taken NOWAIT. Inside a hand a busy bank stores the return for the
-- table's continuation (never waits, never strands). Outside a hand the caller
-- waits as it always did (up to 4 s, the old lock_timeout), by NOWAIT retries.
CREATE FUNCTION public.fn_ca_deleted_wallet_return_or_defer(p_club uuid, p_user uuid, p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_deadline timestamptz := clock_timestamp() + interval '4 seconds';
 v_message text;
 v_table uuid;
BEGIN
 LOOP
  BEGIN
   PERFORM public.fn_ca_deleted_wallet_bank_return_nowait(p_club, p_user, p_source);
   RETURN;
  EXCEPTION WHEN lock_not_available THEN
   GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
   IF v_message NOT LIKE '%relation "clubs"%' THEN RAISE; END IF;
  END;
  v_table := public.fn_ca_hand_context_table();
  IF v_table IS NOT NULL THEN
   INSERT INTO public.hand_wallet_return_pending (table_id, club_id, user_id, kind)
   VALUES (v_table, p_club, p_user,
           CASE WHEN p_source = 'agent_wallet' THEN 'deleted_agent_wallet' ELSE 'deleted_player_wallet' END)
   ON CONFLICT DO NOTHING;
   RETURN;
  END IF;
  IF clock_timestamp() >= v_deadline THEN
   RAISE EXCEPTION 'deleted_wallet_return: the bank of club % stayed busy', p_club USING ERRCODE = '55P03';
  END IF;
  PERFORM pg_sleep(0.05);
 END LOOP;
END;
$function$;

-- THE TABLE'S CONTINUATION BANKS ITS DEFERRED RETURNS (called by
-- fn_project_hand_side_effects after its up-front try-locks and inside its 1 s
-- lock deadline (20261118191855), the way
-- fn_ca_bank_pending_hand_obligations banks a drop). Each return in its own
-- subtransaction; the bank row NOWAIT, the record at most 250 ms and never past
-- p_deadline (the caller's 1 s lock deadline). Busy, or out of time, leaves the row
-- for the next pass; a refusal keeps it and says why (fn_ca_post_commit_lag_watch
-- pages a row older than 15 s). Nothing scheduled (CLAUDE.md 10.12).
CREATE FUNCTION public.fn_ca_bank_pending_wallet_returns(p_table_id uuid, p_deadline timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 k record;
 v_lock_timeout text := current_setting('lock_timeout');
 v_state text; v_msg text; v_res jsonb;
 v_items jsonb := '[]'::jsonb;
BEGIN
 FOR k IN SELECT w.club_id, w.user_id, w.kind FROM public.hand_wallet_return_pending w
           WHERE w.table_id = p_table_id ORDER BY w.created_at, w.club_id, w.user_id, w.kind LOOP
  v_state := NULL; v_msg := NULL;
  EXIT WHEN p_deadline IS NOT NULL AND clock_timestamp() >= p_deadline;
  BEGIN
   PERFORM 1 FROM public.hand_wallet_return_pending w
    WHERE w.table_id = p_table_id AND w.club_id = k.club_id AND w.user_id = k.user_id AND w.kind = k.kind
      FOR UPDATE SKIP LOCKED;
   IF FOUND THEN
    PERFORM set_config('lock_timeout', greatest(1, least(250,
      COALESCE(floor(extract(epoch FROM p_deadline - clock_timestamp()) * 1000)::int, 250)))::text || 'ms', true);
    IF k.kind = 'horse_split_late_credit' THEN
     v_res := jsonb_build_object('amount', public.fn_ca_horse_split_return_now(k.club_id, k.user_id));
    ELSE
     v_res := public.fn_ca_deleted_wallet_bank_return_nowait(k.club_id, k.user_id,
              CASE WHEN k.kind = 'deleted_agent_wallet' THEN 'agent_wallet' ELSE 'player_wallet' END);
    END IF;
    DELETE FROM public.hand_wallet_return_pending w
     WHERE w.table_id = p_table_id AND w.club_id = k.club_id AND w.user_id = k.user_id AND w.kind = k.kind;
    v_items := v_items || jsonb_build_object('kind', k.kind, 'user_id', k.user_id, 'status', 'banked', 'result', v_res);
   END IF;
  EXCEPTION
   WHEN lock_not_available THEN v_state := 'busy';
   WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM set_config('lock_timeout', v_lock_timeout, true);
  IF v_state = 'busy' THEN
   v_items := v_items || jsonb_build_object('kind', k.kind, 'user_id', k.user_id, 'status', 'busy');
  ELSIF v_state IS NOT NULL THEN
   UPDATE public.hand_wallet_return_pending w
      SET attempts = w.attempts + 1, last_attempt_at = clock_timestamp(), last_error = left(v_state || ': ' || v_msg, 500)
    WHERE w.table_id = p_table_id AND w.club_id = k.club_id AND w.user_id = k.user_id AND w.kind = k.kind;
   v_items := v_items || jsonb_build_object('kind', k.kind, 'user_id', k.user_id, 'status', 'refused', 'error', v_msg);
  END IF;
 END LOOP;
 RETURN jsonb_build_object(
  'status', CASE WHEN EXISTS (SELECT 1 FROM public.hand_wallet_return_pending w WHERE w.table_id = p_table_id)
                 THEN 'pending' ELSE 'banked' END,
  'table_id', p_table_id, 'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_deleted_wallet_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_club uuid;
BEGIN
 IF TG_TABLE_NAME='profiles' THEN
  -- Only clubs where the person holds free chips have anything to return.
  FOR v_club IN
   SELECT s.club_id FROM (
    SELECT m.club_id FROM public.club_members m WHERE m.user_id=NEW.id
      AND coalesce(m.chip_balance,0)-coalesce(m.held_chips,0)-coalesce(m.locked_chips,0) > 0
    UNION
    SELECT a.club_id FROM public.agents a WHERE a.user_id=NEW.id
      AND coalesce(a.agent_wallet_balance,0) > 0
   ) s ORDER BY s.club_id
  LOOP
   PERFORM public.fn_ca_deleted_wallet_bank_return(v_club,NEW.id,'wallets');
  END LOOP;
  RETURN NEW;
 END IF;
 -- Only the trusted owning stage may hold a pass-through credit until its
 -- original transfer and final net-balance assertions have completed. Each
 -- stage flushes these exact pinned recipients before returning success.
 -- A browser-set GUC or an unrelated row never defers. Since 20261022 weekly
 -- commission is credited to agent wallets, so the commission stage's pinned
 -- agent-wallet recipients defer exactly as its member wallets did.
 IF TG_TABLE_NAME='agents' AND public.fn_caller_is_engine() IS TRUE
  AND nullif(current_setting('app.accounting_routing_context',true),'') IS NOT NULL
  AND current_setting('app.deleted_wallet_routing_stage',true)='commission'
  AND to_regclass('pg_temp._routed_nodes') IS NOT NULL THEN
  IF EXISTS(SELECT FROM pg_temp._routed_nodes n WHERE n.club_id=NEW.club_id AND n.user_id=NEW.user_id) THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='club_members' AND public.fn_caller_is_engine() IS TRUE
  AND nullif(current_setting('app.accounting_routing_context',true),'') IS NOT NULL THEN
  IF current_setting('app.deleted_wallet_routing_stage',true)='commission'
   AND to_regclass('pg_temp._routed_nodes') IS NOT NULL THEN
   IF EXISTS(SELECT FROM pg_temp._routed_nodes n WHERE n.club_id=NEW.club_id AND n.user_id=NEW.user_id) THEN RETURN NEW; END IF;
  ELSIF current_setting('app.deleted_wallet_routing_stage',true)='rakeback'
   AND to_regclass('pg_temp._routed_player_wallets') IS NOT NULL THEN
   IF EXISTS(SELECT FROM pg_temp._routed_player_wallets w WHERE w.club_id=NEW.club_id AND w.user_id=NEW.user_id) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND status='deleted') THEN
  -- A HAND NEVER WAITS ON THE CLUB BANK (20261118161644): the bank row is
  -- taken NOWAIT; inside a hand a busy bank stores the return for the table's
  -- own post-commit continuation (fn_ca_bank_pending_wallet_returns).
  PERFORM public.fn_ca_deleted_wallet_return_or_defer(NEW.club_id,NEW.user_id,CASE WHEN TG_TABLE_NAME='agents' THEN 'agent_wallet' ELSE 'player_wallet' END);
 END IF;
 RETURN NEW;
END;
$function$;

-- The horse club split late return (Dan, 2026-11-03), callable: returns a
-- split-departed horse record's whole balance to that club's bank through
-- the same Club Bank claim, ledger and receipt as before. Takes the record and
-- the bank row NOWAIT (only chip_treasury changes: NO KEY UPDATE), so it never
-- waits; lock_not_available reaches the caller. Returns the amount moved, 0
-- when the record no longer qualifies.
CREATE FUNCTION public.fn_ca_horse_split_return_now(p_club uuid, p_user uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_op constant uuid := '5b11c1b0-2026-1102-0000-000000000001';
  c_keys constant text[] := ARRAY['app.ledger_category', 'app.ledger_counterparty',
    'app.ledger_counterparty_entity', 'app.ledger_counterparty_label', 'app.ledger_settlement',
    'app.ledger_idempotency_key', 'app.ledger_correlation', 'app.ledger_autoskip_clubs',
    'app.ledger_autoskip_club_members'];
  v_amount numeric;
  v_status text;
  v_saved text[] := ARRAY[]::text[];
  v_key uuid;
  v_bank_before numeric;
  v_bank_after numeric;
  v_after numeric;
  i integer;
BEGIN
  SELECT coalesce(m.chip_balance, 0), m.membership_lifecycle_status INTO v_amount, v_status
    FROM public.club_members m WHERE m.club_id = p_club AND m.user_id = p_user FOR NO KEY UPDATE NOWAIT;
  IF NOT FOUND OR v_amount <= 0 OR v_status IS DISTINCT FROM 'departed' THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts d
                  WHERE d.operation_id = c_op AND d.kind = 'departed'
                    AND d.horse_id = p_user AND d.club_id = p_club)
     OR public.fn_ca_horse_assigned_club(p_user) IS NOT DISTINCT FROM p_club THEN
    RETURN 0;
  END IF;

  FOR i IN 1 .. array_length(c_keys, 1) LOOP
    v_saved := v_saved || coalesce(current_setting(c_keys[i], true), '');
  END LOOP;

  v_key := md5('horse-split-late-return:' || p_club::text || ':' || p_user::text || ':'
               || txid_current()::text || ':' || clock_timestamp()::text || ':' || v_amount::text)::uuid;
  SELECT coalesce(c.chip_treasury, 0) INTO v_bank_before FROM public.clubs c WHERE c.id = p_club FOR NO KEY UPDATE NOWAIT;
  IF v_bank_before IS NULL THEN RAISE EXCEPTION 'horse_split_late_return_club_missing %', p_club; END IF;
  PERFORM public.fn_ca_declare_ledger('club_bank_claim', 'club_treasury', p_club, NULL,
    'club_bank_claim:' || v_key::text, ARRAY['clubs']);
  PERFORM set_config('app.ledger_correlation', v_key::text, true);
  PERFORM set_config('app.ledger_autoskip_club_members', '', true);
  UPDATE public.club_members SET chip_balance = coalesce(chip_balance, 0) - v_amount, updated_at = now()
   WHERE club_id = p_club AND user_id = p_user RETURNING chip_balance INTO v_after;
  IF v_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'horse_split_late_return_balance_moved % % %', p_club, p_user, v_after;
  END IF;
  UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury, 0) + v_amount, updated_at = now()
   WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
  PERFORM set_config('app.ledger_autoskip_clubs', '', true);
  PERFORM set_config('app.ledger_autoskip_club_members', '', true);
  INSERT INTO public.chip_transactions(club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
  VALUES (p_club, p_user, NULL, v_amount, 'club_bank_claim',
          'Horse Club Split: Late Prize Returned To The Club Bank (Dan, 2026-11-03)',
          jsonb_build_object('op_id', v_key, 'operation', 'horse-club-split-20261102', 'operation_id', c_op,
            'leg', 'late_return', 'actor', 'horse_club_split_late_return',
            'source', 'player_wallet', 'destination', 'club_bank',
            'bank_before', v_bank_before, 'bank_after', v_bank_after,
            'holder_balance_before', v_amount, 'holder_balance_after', v_after),
          v_bank_after);
  INSERT INTO public.ca_horse_club_split_late_returns(club_id, horse_id, amount, op_id, bank_before, bank_after)
  VALUES (p_club, p_user, v_amount, v_key, v_bank_before, v_bank_after);

  FOR i IN 1 .. array_length(c_keys, 1) LOOP
    PERFORM set_config(c_keys[i], v_saved[i], true);
  END LOOP;
  RETURN v_amount;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_split_return_late_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deadline timestamptz := clock_timestamp() + interval '200 milliseconds';
  v_table uuid;
  v_state text;
  v_message text;
  v_busy boolean;
BEGIN
  IF coalesce(NEW.chip_balance, 0) <= 0 OR NEW.membership_lifecycle_status IS DISTINCT FROM 'departed' THEN
    RETURN NULL;
  END IF;
  -- A HAND NEVER WAITS ON THE CLUB BANK (20261118161644). The return takes the
  -- bank NOWAIT. Inside a hand a busy bank stores it for the table's own
  -- post-commit continuation (fn_ca_bank_pending_wallet_returns): it is banked
  -- by the next pass and never strands. Outside a hand it retries for the
  -- 200 ms it always waited, then keeps its designed fallback.
  LOOP
    v_busy := false;
    BEGIN
      PERFORM public.fn_ca_horse_split_return_now(NEW.club_id, NEW.user_id);
      RETURN NULL;
    EXCEPTION
      WHEN lock_not_available THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        v_busy := true;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    END;
    EXIT WHEN NOT v_busy;
    v_table := public.fn_ca_hand_context_table();
    IF v_table IS NOT NULL THEN
      INSERT INTO public.hand_wallet_return_pending (table_id, club_id, user_id, kind)
      VALUES (v_table, NEW.club_id, NEW.user_id, 'horse_split_late_credit')
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END IF;
    EXIT WHEN clock_timestamp() >= v_deadline;
    PERFORM pg_sleep(0.02);
  END LOOP;
  -- Everything the return wrote rolled back with its subtransaction: the
  -- credit stays on the record and fn_ca_horse_club_split_late_claims
  -- returns it later (the 2026-11-03 design, unchanged outside a hand).
  BEGIN
    INSERT INTO public.financial_alerts(severity, source, message, context)
    VALUES ('warning', 'horse_split.late_return_deferred',
            'A late prize on a split-departed horse record stayed on the record; the split late claim returns it after its events finish.',
            jsonb_build_object('club_id', NEW.club_id, 'horse_id', NEW.user_id, 'amount', NEW.chip_balance,
                               'sqlstate', v_state, 'error', v_message));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a note that cannot be written never blocks the payment it describes
  END;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.fn_union_totals_follow_club_count_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r RECORD;
BEGIN
  -- Row form of fn_union_totals_follow_club_counts (20261118161703): the
  -- trigger's column list and WHEN already say a count changed.
  FOR r IN
    SELECT DISTINCT uc.union_id
      FROM union_clubs uc
     WHERE uc.club_id = NEW.id
  LOOP
    PERFORM public.recompute_union_levels(r.union_id, true);
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_post_commit_lag_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  c_source  constant text    := 'fn_ca_post_commit_lag_watch';
  c_warn_s  constant numeric := 2;    -- the owner's hand-gap limit (2026-11-17 22:22 CT)
  c_clear_s constant numeric := 1.5;  -- resolve below this: no flapping at the line
  c_crit_s  constant numeric := 15;
  c_warn_n  constant int     := 5;
  c_crit_n  constant int     := 3;
  c_max_new constant int     := 10;
  v_judged  jsonb;
  v_lagging int;
  v_new int := 0; v_escalated int := 0; v_resolved int := 0;
  r record;
BEGIN
  WITH recent AS (
    SELECT h.table_id, h.post_commit_completed_at IS NULL AS pending,
           extract(epoch FROM COALESCE(h.post_commit_completed_at, now()) - h.committed_at) AS lag_s
      FROM hand_atomic_commits h
     WHERE h.committed_at >= now() - interval '5 minutes'
       AND h.post_commit_payload IS NOT NULL
    UNION ALL
    SELECT h.table_id, true, extract(epoch FROM now() - h.committed_at)
      FROM hand_atomic_commits h
     WHERE h.post_commit_payload IS NOT NULL AND h.post_commit_completed_at IS NULL
       AND h.committed_at < now() - interval '5 minutes'
    UNION ALL
    -- 20261118161644: a deferred wallet return is pending post-commit work of
    -- its table; older than 15 s it is critical like a pending hand.
    SELECT w.table_id, true, extract(epoch FROM now() - w.created_at)
      FROM hand_wallet_return_pending w
  ), per AS (
    SELECT table_id, count(*) AS hands, count(*) FILTER (WHERE pending) AS pending,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY lag_s) AS p95_s,
           max(lag_s) AS max_s, COALESCE(max(lag_s) FILTER (WHERE pending), 0) AS oldest_pending_s
      FROM recent GROUP BY table_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', p.table_id, 'hands', p.hands, 'pending', p.pending,
           'p95_s', round(p.p95_s::numeric, 3), 'max_s', round(p.max_s::numeric, 3),
           'oldest_pending_s', round(p.oldest_pending_s::numeric, 3),
           'severity', CASE WHEN (p.hands >= c_crit_n AND p.p95_s > c_crit_s) OR p.oldest_pending_s > c_crit_s
                            THEN 'critical'
                            WHEN p.hands >= c_warn_n AND p.p95_s > c_warn_s THEN 'warning' END,
           'clear', p.p95_s <= c_clear_s AND p.oldest_pending_s <= c_clear_s)), '[]'::jsonb)
    INTO v_judged
    FROM per p;

  SELECT count(*) INTO v_lagging FROM jsonb_array_elements(v_judged) j WHERE j->>'severity' IS NOT NULL;

  -- Resolve: an open alert whose table has no hands now, or is back under the clear line.
  WITH done AS (
    UPDATE financial_alerts fa
       SET resolved = true, resolved_at = now(),
           resolution = 'post-commit p95 back under ' || c_clear_s || ' s on this table'
     WHERE fa.source = c_source AND NOT fa.resolved
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_judged) j
                        WHERE j->>'table_id' = fa.context->>'table_id' AND NOT (j->>'clear')::boolean)
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM done;

  FOR r IN
    SELECT j, (j->>'table_id')::uuid AS table_id, j->>'severity' AS severity,
           (SELECT fa.severity FROM financial_alerts fa
             WHERE fa.source = c_source AND NOT fa.resolved AND fa.context->>'table_id' = j->>'table_id'
             ORDER BY fa.created_at DESC LIMIT 1) AS open_severity
      FROM jsonb_array_elements(v_judged) j
     WHERE j->>'severity' IS NOT NULL
     ORDER BY (j->>'severity' = 'critical') DESC, (j->>'p95_s')::numeric DESC, j->>'table_id'
  LOOP
    CONTINUE WHEN r.open_severity = 'critical'
               OR (r.open_severity = 'warning' AND r.severity = 'warning');
    IF r.open_severity = 'warning' THEN
      UPDATE financial_alerts fa
         SET resolved = true, resolved_at = now(), resolution = 'escalated to critical'
       WHERE fa.source = c_source AND NOT fa.resolved AND fa.context->>'table_id' = r.table_id::text;
      v_escalated := v_escalated + 1;
    ELSE
      CONTINUE WHEN v_new >= c_max_new;
      v_new := v_new + 1;
    END IF;
    INSERT INTO financial_alerts (severity, source, message, context)
    SELECT r.severity, c_source,
           CASE r.severity
             WHEN 'critical' THEN 'Hands are waiting on their post-commit work: on this table the p95 from commit to post-commit completion over the last 5 minutes is above 15 s, or a hand has been pending longer than 15 s. The hand gap is far over the 2 s limit; find the lock the post-commit envelope is waiting on.'
             ELSE 'Post-commit work is slowing hands down: on this table the p95 from commit to post-commit completion over the last 5 minutes is above the 2 s hand-gap limit.'
           END,
           r.j || jsonb_build_object(
             'table_name', t.name, 'club_id', t.club_id, 'union_id', t.union_id,
             'window', '5 minutes', 'warn_p95_s', c_warn_s, 'critical_p95_s', c_crit_s,
             'lagging_tables', v_lagging)
      FROM (SELECT 1) one
      LEFT JOIN tables t ON t.id = r.table_id;
  END LOOP;

  RETURN jsonb_build_object('lagging_tables', v_lagging, 'opened', v_new, 'escalated', v_escalated,
                            'resolved', v_resolved, 'checked_at', now());
END
$function$;

-- Grants exactly as production holds them (CREATE OR REPLACE keeps them; said
-- here so every reader of this file can see who may call what).
REVOKE ALL ON FUNCTION public.fn_ca_deleted_wallet_bank_return(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_deleted_wallet_bank_return(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_deleted_wallet_credit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_deleted_wallet_credit() TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_split_return_late_credit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_deleted_wallet_bank_return_nowait(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_deleted_wallet_bank_return_nowait(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_deleted_profile_bank_return() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_deleted_profile_bank_return() TO service_role;
REVOKE ALL ON FUNCTION public.fn_union_totals_follow_club_count_row() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_totals_follow_club_count_row() TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_hand_context_table() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_deleted_wallet_return_or_defer(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_split_return_now(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_wallet_returns(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_wallet_returns(uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_post_commit_lag_watch() FROM PUBLIC, anon, authenticated;

COMMIT;
