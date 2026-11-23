-- 20261123071151_a_horse_claim_never_waits_on_a_dashboard_revision.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A HORSE CLAIM NEVER WAITS ON A DASHBOARD REVISION
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. At 06:40:02.530 UTC on 2026-11-23
-- the daily prune (cron ca-diamond-prune-history-daily, 40 6 * * *) deadlocked
-- with the horse claim tick (cron ca-horse-claim-due-minute) and Postgres
-- cancelled the prune; its 650 abandoned rows (351 players) are still there.
-- The ERROR row names both sides:
--
--   Process 1164027: SELECT public.fn_ca_diamond_prune_history();
--   Process 1164029: SELECT public.fn_ca_horse_claim_due(500)
--
-- and the prune's own line names where it waited:
--
--   while inserting index tuple (206,21) in relation
--   "daily_challenge_dashboard_revisions"
--   INSERT INTO public.daily_challenge_dashboard_revisions ... ON CONFLICT
--   (user_id) DO UPDATE SET revision = ... + 1
--   bump_daily_challenge_dashboard_revision() line 22
--   DELETE FROM public.user_daily_challenges WHERE NOT completed AND
--   created_at < now() - make_interval(days => p_abandoned_days)
--   fn_ca_diamond_prune_history(integer,integer,integer) line 29
--
-- It is the only deadlock naming either function from 2026-11-16 to
-- 2026-11-23 (24-hour slices of the log).
--
-- THE CAUSE, BY LINE. daily_challenge_dashboard_revisions holds one cursor row
-- per player. bump_daily_challenge_dashboard_revision (an AFTER ROW trigger on
-- user_daily_challenges and on profiles.diamonds, among others) upserts that
-- row at its line 22, so whoever bumps it holds it until COMMIT. Both crons
-- bump many players' rows in one transaction, in different orders:
--   - the prune's DELETE at line 29 bumps every player it deletes a row for,
--     in the order the rows come off the table;
--   - fn_ca_horse_claim_due claims up to 500 horse rewards in one run, in
--     challenge-row id order, and each claim (claim_daily_challenge_serialized
--     _body: the claimed UPDATE and the diamonds UPDATE) bumps that horse's
--     row inside the claim, BY WAITING.
-- The prune held horse A's row and waited for horse B's, which this run had
-- bumped; this run then reached A's claim and waited for A's row.
--
-- THE FIX. fn_ca_horse_claim_due already takes a horse's other locks before
-- the claim and never waits for them (20261015032612, "a horse claim never
-- waits on a player lock"): the daily-missions advisory lock (tried) and the
-- profiles row (SKIP LOCKED); a busy horse is left owed for the next minute.
-- The revision row was the one player row it still took by waiting, inside
-- the claim. It is now taken there too, FOR NO KEY UPDATE SKIP LOCKED (the
-- mode the trigger's ON CONFLICT DO UPDATE takes, so nothing inside upgrades),
-- after the profiles row, the order every writer takes them (profiles, then
-- the bump). A horse whose row someone holds is skipped exactly like a busy
-- profile: not claimed, not deferred, not counted, and still the oldest thing
-- owed a minute later. A horse with no row yet is claimed as before. The claim
-- can then never wait on a revision row, so it cannot close this cycle with
-- the prune or with any other writer that bumps several players at once.
--
-- WHAT DOES NOT CHANGE. Every reward, amount, reference, refusal and
-- deferral; every bump: each change to a player's missions still raises that
-- player's revision by one in its own transaction, which is all the readers
-- use (useDailyMissionRealtimeCatchUp refreshes when the durable cursor is
-- newer than the revision on screen; get_daily_challenge_dashboard_v3 returns
-- it). The prune, the trigger and the claim body are unchanged. Nothing reads
-- is_horse beyond the candidate set this function already had.
--
-- Proof: scripts/dev/prove-a-horse-claim-never-waits-on-a-dashboard-revision.py
-- Law: tests/a-horse-claim-never-waits-on-a-dashboard-revision.law.test.ts
-- Changelog: docs/changelog/2026-11-23-a-horse-claim-never-waits-on-a-dashboard-revision.md
--
-- HOW. One anchored edit of the live definition: production's text must hash
-- to cc2313be... (the 20261030003124 postimage, read 2026-11-23), the needle
-- must occur exactly once, the result must hash to the derived postimage, and
-- owner, grants, SECURITY and settings must not move.
-- @replaces-md5: public.fn_ca_horse_claim_due(integer)=cc2313bee55c2149786824aae8d3b87e
-- @live-proof: (SELECT position('FROM public.daily_challenge_dashboard_revisions v' IN pg_get_functiondef('public.fn_ca_horse_claim_due(integer)'::regprocedure)) BETWEEN position('FOR NO KEY UPDATE SKIP LOCKED' IN pg_get_functiondef('public.fn_ca_horse_claim_due(integer)'::regprocedure)) AND position('PERFORM public.claim_daily_challenge_serialized_body(' IN pg_get_functiondef('public.fn_ca_horse_claim_due(integer)'::regprocedure)))
-- @probe-exempt: public.fn_ca_horse_claim_due pays up to 500 horse rewards for up to 45 s while holding live player rows, which an install transaction under the 12 s budget must not run; it runs live every minute after install, and the native proof runs it before and after this edit

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $skip_busy_revision$
DECLARE
  target oid := 'public.fn_ca_horse_claim_due(integer)'::regprocedure;
  before_def text; after_def text;
  before_owner oid; before_acl aclitem[]; before_config text[]; before_definer boolean;
  old_text text := $old$    PERFORM 1 FROM public.profiles p WHERE p.id = r.user_id FOR NO KEY UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
$old$;
  new_text text := $new$    PERFORM 1 FROM public.profiles p WHERE p.id = r.user_id FOR NO KEY UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    -- AND ITS DASHBOARD REVISION ROW (20261123071151). Every claim bumps the
    -- horse's daily_challenge_dashboard_revisions row through the
    -- bump_daily_challenge_dashboard_revision triggers on its challenge row and
    -- its diamonds, and this run keeps every horse's row until it ends. It used
    -- to take the next horse's row by waiting, inside the claim, while the
    -- daily prune (fn_ca_diamond_prune_history) held it, having bumped it for a
    -- deleted abandoned row, and waited for a row this run had bumped: the
    -- deadlock of 2026-11-23 06:40 UTC. The row is taken here, with the others,
    -- without waiting; a horse whose row is busy is left owed for the next run,
    -- like a busy profile. A horse with no row yet is claimed as before (its
    -- first bump creates it). What a claim pays, and every revision it bumps,
    -- is unchanged.
    PERFORM 1 FROM public.daily_challenge_dashboard_revisions v
     WHERE v.user_id = r.user_id FOR NO KEY UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND AND EXISTS (
      SELECT 1 FROM public.daily_challenge_dashboard_revisions v WHERE v.user_id = r.user_id);
$new$;
BEGIN
  SELECT pg_get_functiondef(oid), proowner, proacl, proconfig, prosecdef
    INTO before_def, before_owner, before_acl, before_config, before_definer
    FROM pg_proc WHERE oid = target;
  IF position('daily_challenge_dashboard_revisions' IN before_def) > 0 THEN
    RAISE EXCEPTION 'fn_ca_horse_claim_due already takes its revision row: re-read before editing';
  END IF;
  IF md5(before_def) <> 'cc2313bee55c2149786824aae8d3b87e' THEN
    RAISE EXCEPTION 'fn_ca_horse_claim_due is not the pinned text (md5 %)', md5(before_def);
  END IF;
  IF (length(before_def) - length(replace(before_def, old_text, ''))) / length(old_text) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_horse_claim_due anchor was expected exactly once';
  END IF;
  IF md5(replace(before_def, old_text, new_text)) <> '88cfc5b8cbde2247e42b41cdbf457d09' THEN
    RAISE EXCEPTION 'fn_ca_horse_claim_due: substituted text is not the derived postimage';
  END IF;
  EXECUTE replace(before_def, old_text, new_text);
  SELECT pg_get_functiondef(target) INTO after_def;
  IF md5(after_def) <> '88cfc5b8cbde2247e42b41cdbf457d09'
     OR replace(after_def, new_text, old_text) <> before_def
     OR EXISTS (SELECT 1 FROM pg_proc WHERE oid = target
                 AND (proowner IS DISTINCT FROM before_owner OR proacl IS DISTINCT FROM before_acl
                      OR proconfig IS DISTINCT FROM before_config OR prosecdef IS DISTINCT FROM before_definer)) THEN
    RAISE EXCEPTION 'fn_ca_horse_claim_due: postimage, owner, grants or settings differ';
  END IF;
END
$skip_busy_revision$;

DO $verify_claim$
DECLARE
  v_profile integer := position('FROM public.profiles p WHERE p.id = r.user_id FOR NO KEY UPDATE SKIP LOCKED' IN pg_get_functiondef('public.fn_ca_horse_claim_due(integer)'::regprocedure));
  v_revision integer := position('FROM public.daily_challenge_dashboard_revisions v' IN pg_get_functiondef('public.fn_ca_horse_claim_due(integer)'::regprocedure));
  v_claim integer := position('PERFORM public.claim_daily_challenge_serialized_body(' IN pg_get_functiondef('public.fn_ca_horse_claim_due(integer)'::regprocedure));
BEGIN
  IF v_profile = 0 OR v_revision = 0 OR v_claim = 0
     OR NOT (v_profile < v_revision AND v_revision < v_claim) THEN
    RAISE EXCEPTION 'the horse claim does not take its revision row between its profile and its claim';
  END IF;
END
$verify_claim$;

COMMIT;
