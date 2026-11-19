"""Exercise background admission against a held original wallet in real PostgreSQL."""
import concurrent.futures
import json
import select
import subprocess
import time
from tournament_background_admission_fixture import install_sources, open_sibling, request_continuation


MIGRATION = 'supabase/migrations/20261118015251_keep_background_tournament_registration_from_queueing_behind.sql'
ACTIVATION = 'supabase/migrations/20261118024212_activate_scoped_funded_tournament_attendance.sql'
TOURNAMENT = '46462000-0000-4000-8000-000000000003'
ENTRANT = '46468100-0000-4000-8000-000000000005'
CLUB = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
LANE = f"hashtextextended('ca:tournament-terminal-settlement:v1:{TOURNAMENT}',0)"


def qualify_background_admission(e, database, target_input):
    def sql(statement, label, check=True):
        return e.sql(database, statement, label=label, check=check)

    def await_backend(name, expected):
        until = time.monotonic() + 6
        while time.monotonic() < until:
            _, seen, _ = sql(f"SELECT EXISTS (SELECT FROM pg_stat_activity WHERE "
                             f"application_name='{name}' AND {expected});", 'observe-'+name)
            if seen.strip() == 't':
                return
            time.sleep(0.04)
        raise RuntimeError('Missing original registration wait: '+name)

    def hand_lane(label):
        return sql(f"SELECT pg_try_advisory_xact_lock_shared({LANE});",label)[1].strip()

    case = e.database(database)
    database = case
    install_sources(e, case)
    open_sibling(e, case, TOURNAMENT, CLUB)
    if json.loads(sql(request_continuation(TOURNAMENT,0),'original-hand-anchor')[1]).get('sequence') != '0':
        raise RuntimeError('Original F06 hand anchor missing')
    psql = [str(e.pg/'psql'), '-X', '-qAt', '-h', str(e.socket), '-p', e.port,
            '-U', 'postgres', '-d', case, '-v', 'ON_ERROR_STOP=1']
    holder = subprocess.Popen(psql, env=e.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write(f"BEGIN; DO $$BEGIN PERFORM 1 FROM public.club_members "
                           f"WHERE club_id='{CLUB}' AND user_id='{ENTRANT}' FOR UPDATE; "
                           "IF NOT FOUND THEN RAISE EXCEPTION 'wallet missing'; END IF; END$$; "
                           "SELECT 'original wallet held';\n")
        holder.stdin.flush()
        if not select.select([holder.stdout], [], [], 5)[0] or holder.stdout.readline().strip() != 'original wallet held':
            raise RuntimeError('Failed to hold the actual paying wallet')
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            request = "SET application_name='attendance_before';\n" + target_input(5).replace('COMMIT;', 'ROLLBACK;')
            old = pool.submit(sql, request, 'original-blocked-registration', False)
            try:
                await_backend('attendance_before', "wait_event_type='Lock'")
                rc,_,errors=sql("\\set VERBOSITY verbose\n"+request_continuation(TOURNAMENT,1),'original-sibling-blocks', False)
                if rc != 3 or '55P03' not in errors:
                    raise RuntimeError('Original F06 continuation must block behind the paid registration')
                if hand_lane('original-event-lock') != 'f':
                    raise RuntimeError('Contended original registration failed to reproduce the event lock')
            finally:
                holder.stdin.write("ROLLBACK;\n"); holder.stdin.flush()
            old_rc,_,old_error=old.result(timeout=12)
            if old_rc:
                raise RuntimeError('Original funded request failed once its wallet became available: '+old_error)

        rc, _, error = e.sql(case,file=e.root/ACTIVATION,label='refuse-activation-without-private-preparation',check=False)
        if rc != 3 or 'funded_mtt_admission_preparation_changed' not in error:
            raise RuntimeError('A missing private dependency must refuse activation with its original source intact')
        e.sql(case,file=e.root/MIGRATION,label='install-inactive-private-preparation')
        _, original, _ = sql("SELECT md5(pg_get_functiondef('public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)'::regprocedure));",'prepared-original-public-door')
        if original.strip() != 'afb54a9112c4fe974ef3b398d8dbe748':
            raise RuntimeError('Private preparation changed serving paid admission')
        e.sql(case,file=e.root/ACTIVATION,label='install-background-registration-guard')
        before=e.snapshot(case,'original-busy-before')
        holder.stdin.write(f"BEGIN; DO $$BEGIN PERFORM 1 FROM public.club_members WHERE "
                           f"club_id='{CLUB}' AND user_id='{ENTRANT}' FOR UPDATE; END$$; "
                           "SELECT 'busy again';\n")
        holder.stdin.flush()
        if not select.select([holder.stdout], [], [], 5)[0] or holder.stdout.readline().strip() != 'busy again':
            raise RuntimeError('Failed to retain the original wallet for the corrected request')
        # The holder stays open until the request has returned. An implementation
        # that waits for wallet release will hit this test's execution deadline.
        rc, _, errors=e.sql(case,"\\set VERBOSITY verbose\n"+target_input(5),
                            label='busy-registration-yields',seconds=4,check=False)
        if rc != 3 or '55P03' not in errors:
            raise RuntimeError('Contended registration did not produce the original lock refusal: '+errors)
        if hand_lane('hand-can-use-event-after-contended-registration') != 't':
            raise RuntimeError('Aborted background registration retained the event lane')
        if e.snapshot(case,'original-busy-after') != before:
            raise RuntimeError('Busy original admission changed money, tickets, occupancy or funding')
        holder.stdin.write('ROLLBACK;\n'); holder.stdin.flush()
    finally:
        holder.communicate('\\q\n', timeout=8)

    # A real original funding receipt invokes the deferred fixture extension.
    # This isolates wall-time spent executing from time waiting on a lock.
    sql(f"""CREATE FUNCTION r46_activation.slow_registration_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.user_id IN ('{ENTRANT}','46468100-0000-4000-8000-000000000006') THEN PERFORM pg_sleep(1.5); END IF; RETURN NULL; END $$;
      CREATE CONSTRAINT TRIGGER zz_registration_commit_delay AFTER INSERT
       ON public.tournament_participant_funding_receipts DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW EXECUTE FUNCTION r46_activation.slow_registration_commit();""",'controlled-slow-deferred-registration')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        request="SET application_name='attendance_commit';\n"+target_input(5)
        write=pool.submit(sql,request,'actual-wallet-funded-deferred-registration',False)
        await_backend('attendance_commit',"wait_event='PgSleep'")
        sibling=sql(request_continuation(TOURNAMENT,1),'sibling-sequence-during-controlled-commit')[1]
        sibling_progress_during_commit = json.loads(sibling).get('sequence') == '1'
        if not sibling_progress_during_commit or write.done():
            raise RuntimeError('Original sibling continuation must commit before the funded purchase')
        if sql("SELECT pg_try_advisory_xact_lock(hashtextextended('ca:tournament-terminal-settlement:v1',0));",'terminal-global-fenced')[1].strip()!='f':
            raise RuntimeError('Terminal global fence lost during payment')
        competing = target_input(6).replace(ENTRANT,'46468100-0000-4000-8000-000000000006')
        rc,_,error = sql("\\set VERBOSITY verbose\n"+competing,'second-admission-does-not-overtake',False)
        if rc != 3 or '55P03' not in error or 'horse_attendance_lane_busy' not in error:
            raise RuntimeError('Concurrent background entrants lost the event admission fence')
        terminal = f"BEGIN; SET LOCAL lock_timeout='30ms'; SET LOCAL request.jwt.claim.role='service_role'; SELECT public.atomic_cancel_tournament('{TOURNAMENT}',NULL); ROLLBACK;"
        rc,_,terminal_error=sql("\\set VERBOSITY verbose\n"+terminal,'original-terminal-cannot-overtake-funding-commit',False)
        if rc!=3 or '55P03' not in terminal_error:
            raise RuntimeError('Original terminal writer did not stop at the payment fence: '+terminal_error)
        if sql(f"SELECT pg_try_advisory_xact_lock({LANE});",'terminal-remains-fenced-until-original-commit')[1].strip() != 'f':
            raise RuntimeError('Terminal transition lost mutual exclusion before original COMMIT')
        rc, _, errors=write.result(timeout=8)
        if rc:
            raise RuntimeError('Funded original registration failed: '+errors)
    _,exact,_=sql(f"SELECT count(*)=1 AND sum(amount)=200 FROM public.tournament_participant_funding_receipts "
                  f"WHERE tournament_id='{TOURNAMENT}' AND user_id='{ENTRANT}' AND operation='entry';",'busy-retry-once-exact-funding')
    if exact.strip()!='t':
        raise RuntimeError('Paid original retry did not produce exactly one 200-chip funding receipt')
    before=e.snapshot(case,'original-committed-before-replay')
    replay=json.loads(sql(target_input(0),'corrected-paid-entry-unknown-outcome-replay')[1])
    if replay.get('reason') != 'already_registered' or e.snapshot(case,'original-committed-after-replay') != before:
        raise RuntimeError('Committed target-full replay changed the original purchase: '+str(replay))
    _, security, _=sql("SELECT NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r "
        "WHERE has_table_privilege(r,'smarter_private.background_mtt_admission','INSERT') OR "
        "has_function_privilege(r,'smarter_private.purchase_mtt_to_attendance_target(uuid,uuid,boolean,bigint)','EXECUTE')) "
        "AND NOT EXISTS(SELECT FROM smarter_private.background_mtt_admission);",'transient-exact-marker-and-private-delegate')
    if security.strip()!='t':
        raise RuntimeError('The admission proof or internal purchase escaped its original caller')
    # Model a separate valid horse with known insufficient funding. The only
    # synthetic edit is its opening wallet; its admission and charge are real.
    poor='46468100-0000-4000-8000-000000000006'
    sql(f"BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.club_members "
        f"SET chip_balance=0 WHERE club_id='{CLUB}' AND user_id='{poor}'; COMMIT;",'insufficient-opening-wallet')
    before=e.snapshot(case,'insufficient-before')
    _,missing,_=sql(target_input(6).replace(ENTRANT,poor),'insufficient-actual-entry')
    if json.loads(missing).get('ok') is not False or e.snapshot(case,'insufficient-after') != before:
        raise RuntimeError('Insufficient funding must refuse the original purchase without any charge')
    # A previously wallet-funded ticket must still buy its original seat at
    # quota, even after the holder's own wallet is empty. Use the retained
    # historical issuer that created supported outstanding cashier tickets.
    e.sql(case,file=e.root/'tests/fixtures/cashier-value-tickets/issuer.sql',label='historical-wallet-ticket-issuer')
    sql(f"BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.club_members SET role='admin' "
        f"WHERE club_id='{CLUB}' AND user_id='{ENTRANT}'; COMMIT;",'cashier-opening-role')
    _, issued, _=sql(f"BEGIN; SET LOCAL request.jwt.claim.sub='{ENTRANT}'; "
        f"SELECT public.fn_issue_tournament_ticket_phase2_core_20260831('{CLUB}','{poor}',200,NULL,'prior-funded-ticket'); COMMIT;",
        'real-original-wallet-ticket')
    ticket_id=json.loads(issued)['ticket_id']
    if json.loads(issued)['your_balance']!=600:
        raise RuntimeError('Original cashier did not fund exactly 200 from its own wallet')
    ticket_request=target_input(0).replace(ENTRANT,poor).replace('true,0','false,0')
    sql(f"UPDATE public.engine_tournament_leases SET heartbeat_at=clock_timestamp() WHERE tournament_id='{TOURNAMENT}'",
        'active-sibling-generation-heartbeat')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        write=pool.submit(sql,"SET application_name='ticket_commit';\n"+ticket_request,'actual-quota-ticket-original',False)
        await_backend('ticket_commit',"wait_event='PgSleep'")
        if json.loads(sql(request_continuation(TOURNAMENT,2),'cashier-sibling-original-continues')[1]).get('sequence')!='2' or write.done():
            raise RuntimeError('Ticket admission prevents a sibling hand from advancing during its commit')
        rc, paid, error=write.result(timeout=10)
    if rc or json.loads(paid).get('ticket_id')!=ticket_id or json.loads(paid).get('wallet_chips_credited')!=0:
        raise RuntimeError('The original funded ticket did not settle to the right entrant: '+error)
    _, money, _=sql(f"SELECT (SELECT chip_balance FROM public.club_members WHERE club_id='{CLUB}' AND user_id='{poor}')=0 "
        f"AND (SELECT count(*)=1 FROM public.chip_transactions WHERE transaction_type='tournament_ticket_redeem' AND metadata->>'ticket_id'='{ticket_id}') "
        f"AND (SELECT status='redeemed' FROM public.tournament_tickets WHERE id='{ticket_id}') "
        f"AND (SELECT count(*)=1 FROM public.table_seats WHERE user_id='{poor}' AND left_at IS NULL);",'cashier-escrow-debited-once')
    if money.strip()!='t':
        raise RuntimeError('Repeated or missing original cashier-ticket debit/seat')
    before=e.snapshot(case,'target-full-ticket-before-replay')
    sql(ticket_request,'target-full-ticket-replay')
    if before!=e.snapshot(case,'target-full-ticket-after-replay'):
        raise RuntimeError('An already-consumed ticket changed wallet, funding or occupancy')
    e.discard(case)
    e.report['native'].append({'case':'background_admission_yields_on_a_contended_original_wallet',
        'preexisting_event_lane_reproduced':True,'busy_55P03_entire_request_unchanged':True,
        'sibling_event_lane_available_with_wallet_still_held':True,'funding_once':True,
        'terminal_fenced_through_deferred_commit':True,'unfunded_no_charge':True,
        'historical_cashier_ticket_once_at_target_with_empty_wallet':True,'ticket_sibling_sequence_advanced':True,
        'sibling_progress_during_deferred_commit':sibling_progress_during_commit})
