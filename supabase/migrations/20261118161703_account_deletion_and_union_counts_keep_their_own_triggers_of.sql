-- @install-window: daily-maintenance
-- @locks: public.clubs, public.profiles
-- @live-proof: (to_regprocedure('public.fn_union_totals_follow_club_counts()') IS NULL AND strpos(pg_get_functiondef('public.fn_ca_deleted_wallet_credit()'::regprocedure), 'fn_ca_deleted_wallet_credit_wrong_table') > 0 AND EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.clubs'::regclass AND t.tgname = 'trg_union_totals_follow_club_counts' AND p.proname = 'fn_union_totals_follow_club_count_row') AND EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'zzzz_deleted_profile_bank_return' AND p.proname = 'fn_ca_deleted_profile_bank_return'))
--
-- 20261118161703_account_deletion_and_union_counts_keep_their_own_triggers_of.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ACCOUNT DELETION AND UNION COUNTS KEEP THEIR OWN TRIGGERS OFF THE HAND PATH
-- (incident 075013fd, lane H1; part 2 of 2 after 20261118161644)
--
-- Part 1 took the club bank off the cash hand's path. Two edges remain that
-- the hand-path reader (correctly) still walks:
--
--   1. fn_ca_deleted_wallet_credit serves three triggers. Its account-
--      deletion branch (profiles) calls fn_ca_deleted_wallet_bank_return,
--      which takes the bank row with its 4 s wait - right for deletion, but
--      the same function is the member-credit trigger a hand fires, so the
--      blocking lock is on the hand's path by name. This repoints
--      zzzz_deleted_profile_bank_return to fn_ca_deleted_profile_bank_return
--      (part 1: the same branch, unchanged) and drops the branch from
--      fn_ca_deleted_wallet_credit, which now refuses any other table.
--   2. trg_union_totals_follow_club_counts was a STATEMENT trigger (transition
--      tables) on EVERY clubs UPDATE, 1.09M since stats reset, whose body
--      recomputed the union ladder only when member/admin/super-agent/agent
--      counts changed - which a bank write never does. It becomes a row
--      trigger on UPDATE OF those four columns WHEN one of them changed, the
--      same condition, calling fn_union_totals_follow_club_count_row (part 1).
--      No BEFORE trigger on clubs sets a count (checked on production), so
--      every count change names its column. recompute_union_levels is
--      idempotent; a statement changing several clubs of one union recomputes
--      it once per club instead of once.
--
-- Identical for players: deletion returns the same wallets the same way;
-- ladders recompute on the same changes to the same values.
--
-- WINDOW: replacing the triggers takes SHARE ROW EXCLUSIVE on clubs and
-- profiles, both written in every instant of play (CLAUDE.md section 2 rule
-- 10), so this installs in the daily 04:00 America/Chicago window. It sets no
-- timeout of its own. PRE-FLIGHT: refuses unless part 1 is installed and the
-- two replaced bodies are the texts it was written against.
-- Proof: scripts/ci/test-hand-path-cash-lane.py.

BEGIN;

DO $h1_pre$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_deleted_wallet_credit()'))) IS DISTINCT FROM 'e7a41c2446586d9493ac4b8533b11433' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_ca_deleted_wallet_credit()' USING ERRCODE='55000';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_union_totals_follow_club_counts()'))) IS DISTINCT FROM 'b504648fecedb704e0247a90fd476db2' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_union_totals_follow_club_counts()' USING ERRCODE='55000';
 END IF;
END $h1_pre$;
DO $h1_needs$
BEGIN
 IF to_regprocedure('public.fn_ca_deleted_profile_bank_return()') IS NULL
    OR to_regprocedure('public.fn_union_totals_follow_club_count_row()') IS NULL
    OR to_regprocedure('public.fn_ca_deleted_wallet_bank_return_nowait(uuid,uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'h1_needs_20261118161644' USING ERRCODE='55000';
 END IF;
END $h1_needs$;

CREATE OR REPLACE TRIGGER zzzz_deleted_profile_bank_return
 AFTER UPDATE OF status ON public.profiles
 FOR EACH ROW WHEN (((new.status = 'deleted'::text) AND (old.status IS DISTINCT FROM 'deleted'::text)))
 EXECUTE FUNCTION public.fn_ca_deleted_profile_bank_return();

CREATE OR REPLACE FUNCTION public.fn_ca_deleted_wallet_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF TG_TABLE_NAME NOT IN ('club_members','agents') THEN
  RAISE EXCEPTION 'fn_ca_deleted_wallet_credit_wrong_table: %', TG_TABLE_NAME USING ERRCODE='55000';
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
REVOKE ALL ON FUNCTION public.fn_ca_deleted_wallet_credit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_deleted_wallet_credit() TO service_role;

DROP TRIGGER trg_union_totals_follow_club_counts ON public.clubs;
CREATE TRIGGER trg_union_totals_follow_club_counts
 AFTER UPDATE OF member_count, admin_count, super_agent_count, agent_count ON public.clubs
 FOR EACH ROW WHEN ((COALESCE(new.member_count, 0) IS DISTINCT FROM COALESCE(old.member_count, 0))
                 OR (COALESCE(new.admin_count, 0) IS DISTINCT FROM COALESCE(old.admin_count, 0))
                 OR (COALESCE(new.super_agent_count, 0) IS DISTINCT FROM COALESCE(old.super_agent_count, 0))
                 OR (COALESCE(new.agent_count, 0) IS DISTINCT FROM COALESCE(old.agent_count, 0)))
 EXECUTE FUNCTION public.fn_union_totals_follow_club_count_row();
DROP FUNCTION public.fn_union_totals_follow_club_counts();

COMMIT;
