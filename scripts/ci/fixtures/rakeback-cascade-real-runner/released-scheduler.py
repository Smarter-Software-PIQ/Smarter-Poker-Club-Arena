from concurrent.futures import ThreadPoolExecutor

# Keep the returned tick's transaction open. Transaction advisory locks live
# through this point, so the concurrent books claimant observes the same lock
# it would see during the empty discovery read.
def check_books_lock(want_books_lock):
    hold = """
        BEGIN;
        SET LOCAL statement_timeout='1500s';
        SELECT rr.ok(smarter_private.weekly_payout_next_round() IS NULL, 'released week was not idle');
        SET LOCAL application_name='rr-released-idle';
        SELECT pg_sleep(2);
        ROLLBACK;
    """
    with ThreadPoolExecutor(max_workers=1) as worker:
        idle = worker.submit(q, hold)
        for _ in range(100):
            if one("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rr-released-idle' AND wait_event='PgSleep')")=='t':
                break
            if idle.done():
                raise AssertionError(('idle runner did not reach observation',idle.result()))
            time.sleep(.02)
        else:
            raise AssertionError('idle runner did not reach observation')
        locks = one("""SELECT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler',0))
                     || ':' || pg_try_advisory_xact_lock(hashtextextended('weekly-payout-rounds',0))""")
        assert locks == ('true:false' if want_books_lock else 'false:false'), locks
        idle.result(timeout=5)

check_books_lock(False)
q(next((R/'supabase/migrations').glob('20261116172800_*.sql')).read_text())
check_books_lock(True)

# Observe the real scope function under each lock; inject a stale positive
# only in the stale-probe case. Each test rolls back its own fixture changes.
probe = """
DO $observe$ DECLARE
  src text:=pg_get_functiondef('smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure);
  marker text:='BEGIN';
BEGIN
  EXECUTE overlay(src placing $body$BEGIN
    PERFORM set_config('rr.scope_visits',coalesce(current_setting('rr.scope_visits',true),'')||
      CASE WHEN EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
         AND classid=((hashtextextended('union-accounting-scheduler',0)>>32)&4294967295)::oid
         AND objid=(hashtextextended('union-accounting-scheduler',0)&4294967295)::oid AND objsubid=1)
      THEN 'L' ELSE 'U' END,true);
    IF current_setting('rr.stale_scope',true)='on' AND current_setting('rr.scope_visits')='U' THEN
      RETURN '[{"kind":"club"}]'::jsonb;
    END IF;
$body$ from strpos(src,marker) for length(marker));
END $observe$;
"""
no_extra="(SELECT count(*)=1 AND bool_and(phase='released') FROM public.weekly_accounting_payout_pauses)"
q("BEGIN; SET LOCAL statement_timeout='1500s'; SET LOCAL rr.stale_scope='on';"+probe+
  ok("smarter_private.weekly_payout_next_round() IS NULL","stale unlocked plan cannot book")+
  ok("current_setting('rr.scope_visits')='UL' AND "+no_extra,"locked plan reread before booking")+"ROLLBACK;")

# Model a late uncovered obligation on the otherwise released board. The
# original planner must admit it again under the books lock before it books.
q("BEGIN; SET LOCAL statement_timeout='1500s';"+probe+
  "DELETE FROM smarter_private.weekly_payout_financial_receipts WHERE run_id='"+RUN_ID+"';"+
  ok("smarter_private.weekly_payout_next_round()->>'stage'='rounds_booked'","late scope returned to original booking")+
  ok("current_setting('rr.scope_visits')='UL' AND (SELECT count(*)=2 FROM public.weekly_accounting_payout_pauses)","late scope double-checked under coordinator")+"ROLLBACK;")
case('released payout yields the shared books lock, a stale scope is discarded, and an eligible late scope is booked under both original locks')
