"""Verify bounded payout validation against original principal, W, review and concurrent grant custody."""
import subprocess
import uuid


def verify(db, club, user, table, grant, migration, runfile, check):
    exact = f"public.fn_ca_promo_restricted_at('{club}','{user}','player_wallet','{user}')"
    def compare(capacity):
        return f"SELECT public.fn_ca_promo_restrictions_exceed_capacity('{club}','{user}','player_wallet','{user}',{capacity})"

    def measure(query, setup=''):
        return f"""BEGIN;
            {setup};
            SET LOCAL track_functions='all';
            DO $read$ BEGIN PERFORM set_config('fixture.capacity_result',({query})::text,true); END $read$;
            SELECT current_setting('fixture.capacity_result')||':'||
                   coalesce(pg_stat_get_xact_function_calls(
                       'public.fn_ca_promo_shared_fee_state(uuid,uuid)'::regprocedure),0);
            ROLLBACK;"""

    check('original payout reads fee history when physical chips already cover full principal',
          measure(f'SELECT {exact}>100'), 'false:1')
    runfile(migration)
    check('covered payout with positive principal omits original history',measure(compare(100)), 'false:0')
    check('exact coverage also omits original history',measure(compare(50)), 'false:0')
    check('short capacity still evaluates original FIFO',measure(compare(49)), 'true:1')
    check('short capacity still includes expired principal awaiting return',
          measure(compare(49), f"UPDATE ca_promo_play_through_grants SET expires_at=granted_at+interval '1 millisecond' WHERE id='{grant}'"),
          'true:1')
    hand=str(uuid.uuid4())
    earned=f"""INSERT INTO ca_promo_cash_hand_clocks VALUES('{hand}','{table}',1,clock_timestamp());
        INSERT INTO rake_attributions(club_id,player_id,rake_amount,hand_id) VALUES('{club}','{user}',200,'{hand}');"""
    check('inconclusive raw bound accepts principal already earned through original fees',
          measure(compare(1), earned), 'false:1')
    check('nullable physical capacity retains original SQL comparison',
          compare('NULL').replace('SELECT public.', 'SELECT NULL IS NOT DISTINCT FROM public.'),'t')

    # Grant creation and the original settler serialize on the member wallet.
    # A different connection can observe the old state but cannot settle over
    # a grant in flight. Its next request sees the committed authoritative gift.
    member = str(uuid.uuid4())
    ref = 'concurrent-principal-' + member
    db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance) VALUES('{club}','{member}',100)")
    grant_sql = f"SELECT public.fn_ca_promo_play_through_record_grant('{club}','{member}',17,'club_promo','{ref}',NULL,'promo_wallet','{club}',NULL)"
    ctl = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',db.socket,
                            '-p',db.port,'-U','postgres','-d',db.name],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        ctl.stdin.write("BEGIN; "+grant_sql+"; SELECT 'funded';\n")
        ctl.stdin.flush()
        original = ctl.stdout.readline().strip()
        if not original or ctl.stdout.readline().strip() != 'funded':
            raise AssertionError('second session did not originate the grant')
        check('uncommitted grant is not an original restriction',
              measure(f"SELECT fn_ca_promo_restrictions_exceed_capacity('{club}','{member}','player_wallet','{member}',0)"), 'false:0')
        check('settler retains the original wallet lock during concurrent grant admission', f"""
          BEGIN;SET LOCAL lock_timeout='120ms';
          DO $$BEGIN BEGIN PERFORM fn_ca_promo_play_through_settle('{club}','{member}');RAISE EXCEPTION 'missed original member lock';
             EXCEPTION WHEN lock_not_available THEN NULL;END;END$$;
          SELECT 'locked';ROLLBACK;""", 'locked')
        ctl.stdin.write('COMMIT;\n');ctl.stdin.flush()
    finally:
        _, err = ctl.communicate(timeout=8)
        if ctl.returncode:
            raise AssertionError(err)
    check('committed grant becomes payable only through the full original history',
          measure(f"SELECT fn_ca_promo_restrictions_exceed_capacity('{club}','{member}','player_wallet','{member}',16)"), 'true:1')
    check('grant replay preserves one original receipt', grant_sql, original)
