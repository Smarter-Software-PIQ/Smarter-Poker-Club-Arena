-- 20261103113516_a_settled_correction_for_an_earlier_week_is_that_weeks
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-03 11:35:16 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- A SETTLED CORRECTION FOR AN EARLIER WEEK IS THAT WEEK'S (2026-11-03).
-- On 2026-10-28 40 owner-authorized own-playing-agent corrections (730.46;
-- KINGS CLUB 24, Deep Stack Society 10, The Felt Society 6) were paid from
-- club banks to agent wallets for the original week 2026-10-19..2026-10-26.
-- Each is a settled ca_manual_adjustments row whose decision_note names that
-- week, and each ledger row carries its own adjustment id as settlement_id and
-- no period_start/period_end. fn_club_weekly_accounting_summary counts every
-- rakeback or commission payment inside a period's window that lacks period
-- metadata as a "missing period", so the Oct 26..Nov 2 statements could never
-- be ready: Deep Stack Society's club scope was refused with
-- club_weekly_statement_requires_reconciliation (missing_period_count 10) on
-- every visit from 2026-11-02 20:30 UTC, and the week's books stayed unsealed.
-- The count now excludes exactly a settled agent-wallet correction whose
-- recorded original week ends on or before this period's start (Los Angeles
-- date) and whose amount equals the ledger row. Nothing is paid or re-paid.
-- Rehearsed (rolled back) through fn_process_weekly_accounting with job 272's
-- settings: Deep Stack Society's scope completes, round 2 and round 3 move
-- 0.00, and its weekly statement issues.
-- @live-proof: position('A SETTLED CORRECTION FOR AN EARLIER WEEK IS THAT WEEK''S' IN pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE
 d text:=pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure);
 pre CONSTANT text:='2f04687065b767f826d08a822cc3174d';
 o CONSTANT text:=$o$  AND (close_row.id IS NULL OR l.settlement_id IS DISTINCT FROM close_row.id::text);
 SELECT count(*) INTO stage_count$o$;
 n CONSTANT text:=$n$  AND (close_row.id IS NULL OR l.settlement_id IS DISTINCT FROM close_row.id::text)
  -- A SETTLED CORRECTION FOR AN EARLIER WEEK IS THAT WEEK'S (20261103): an
  -- approved own-playing-agent correction paid inside this window but recorded
  -- for an original week ending on or before this period's start is not an
  -- unperioded payment of this period.
  AND NOT EXISTS(SELECT FROM public.ca_manual_adjustments a
   WHERE l.idempotency_key='manual-agent-adjustment:'||a.id::text AND a.status='settled' AND a.target_kind='agent_wallet'
    AND a.amount=l.amount AND a.decision_note ~ '^own-playing-agent-original-week:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}:'
    AND substring(a.decision_note from '^own-playing-agent-original-week:\d{4}-\d{2}-\d{2}\.\.(\d{4}-\d{2}-\d{2}):')::date
        <=(period.start_at AT TIME ZONE 'America/Los_Angeles')::date);
 SELECT count(*) INTO stage_count$n$;
BEGIN
 IF position('A SETTLED CORRECTION FOR AN EARLIER WEEK IS THAT WEEK''S' IN d)>0 THEN RETURN; END IF;
 IF md5(d) IS DISTINCT FROM pre THEN RAISE EXCEPTION 'club_weekly_summary_preimage_changed'; END IF;
 IF (length(d)-length(replace(d,o,'')))<>length(o) THEN RAISE EXCEPTION 'club_weekly_summary_patch_not_single'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;
COMMIT;
