"""Promo fee state is read from an hourly snapshot; a release and a cash-out read live.

Runs over the full original promo scheme built by test-promo-profit.py. Proves
both directions with real ledger rows and the real wallet exit trigger:
locked promo cannot leave on a stale snapshot, and a member who has paid the
fees is not refused because the snapshot is old.
"""
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVENTS = "'public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure"


def verify(db, club, table, other, migration, runfile, check):
    user, key = str(uuid.uuid4()), str(uuid.uuid4())
    db.run(f"""INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{club}','{user}',50,'member');
      UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second' WHERE enforced_from IS NULL;
      SELECT fn_ca_promo_play_through_record_grant('{club}','{user}',50,'club_promo','{key}',NULL,'promo_wallet','{club}',NULL);""")
    grant = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'")
    target = db.one(f"SELECT fee_target FROM ca_promo_play_through_grants WHERE id='{grant}'")

    def fee(amount):
        hand = str(uuid.uuid4())
        db.run(f"INSERT INTO ca_promo_cash_hand_clocks VALUES('{hand}','{table}',1,clock_timestamp());"
               f"INSERT INTO rake_attributions(club_id,player_id,rake_amount,hand_id) VALUES('{club}','{user}',{amount},'{hand}')")
        return hand

    def leave(amount, after):
        return db.run(f"""BEGIN;
          UPDATE club_members SET chip_balance={after} WHERE club_id='{club}' AND user_id='{user}';
          INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
           VALUES('player_wallet','{user}','agent_wallet','{other}',{amount},'transfer','{club}');
          COMMIT;""", check=False)

    def reads(statement):
        return f"""BEGIN;SET LOCAL track_functions='all';
          DO $x$BEGIN PERFORM {statement};END$x$;
          SELECT coalesce(pg_stat_get_xact_function_calls({EVENTS}),0);ROLLBACK;"""

    state = f"SELECT string_agg(principal_state||'/'||profit_state,',') FROM fn_ca_promo_shared_fee_state('{club}','{user}')"
    live = f"SELECT string_agg(principal_state||'/'||profit_state,',') FROM fn_ca_promo_shared_fee_state_live('{club}','{user}')"
    same = f"""SELECT (SELECT jsonb_agg(to_jsonb(s)) FROM fn_ca_promo_shared_fee_state('{club}','{user}') s)
                    =(SELECT jsonb_agg(to_jsonb(s)) FROM fn_ca_promo_shared_fee_state_live('{club}','{user}') s)"""
    locked = f"SELECT fn_ca_promo_locked_at('{club}','{user}','player_wallet','{user}')"

    refused = leave(10, 40)
    check('before the snapshot exists a locked promo chip cannot leave the wallet',
          f"SELECT {str(refused.returncode != 0 and 'promo_play_through_locked' in refused.stderr).lower()}", 't')

    runfile(migration)
    runfile(migration)  # installs once, harmless twice
    check('the full recomputation keeps its body under the live name and the reader keeps its name',
          """SELECT position('fn_ca_promo_fee_events' in pg_get_functiondef('public.fn_ca_promo_shared_fee_state_live(uuid,uuid)'::regprocedure))>0
             AND position('ca_promo_fee_state_cache' in pg_get_functiondef('public.fn_ca_promo_fee_state_is_current(uuid,uuid)'::regprocedure))>0
             AND position('fn_ca_promo_fee_events' in pg_get_functiondef('public.fn_ca_promo_shared_fee_state(uuid,uuid)'::regprocedure))=0""", 't')
    check('nothing new is open to a browser or to service_role',
          """SELECT count(*) FROM pg_proc p CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(n)
             WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn_ca_promo_%fee_state%'
               AND has_function_privilege(r.n,p.oid,'execute')""", '0')

    check('with no snapshot the reader answers from the live fee history', state, 'locked/locked')
    check('a movement keeps the snapshot it had to compute', reads(f"public.fn_ca_promo_play_through_settle('{club}','{user}')"), '1')
    db.run(f"SELECT fn_ca_promo_play_through_settle('{club}','{user}')")
    check('the snapshot exists', f"SELECT count(*) FROM ca_promo_fee_state_cache WHERE club_id='{club}' AND user_id='{user}'", '1')
    check('the snapshot reads back exactly what the live recomputation returns', same, 't')
    check('a buy-in style settle with a current snapshot reads no fee history',
          reads(f"public.fn_ca_promo_play_through_settle('{club}','{user}')"), '0')
    check('a winnings settle with a current snapshot reads no fee history',
          reads(f"public.fn_ca_promo_profit_settle('{club}','{user}')"), '0')
    check('a per-hand locked read with a current snapshot reads no fee history', reads(locked[7:]), '0')
    check('the promo chip is still locked', locked, '50')

    # Direction one: the member pays the fees AFTER the snapshot. The snapshot
    # is stale and still says locked; nothing on a movement releases early.
    fee(target)
    check('the snapshot is stale by design until the hour or a cash-out', state, 'locked/locked')
    check('the live fee history already sees the fees', f"SELECT split_part(({live}),'/',1)", 'met_pending')
    check('a movement on the stale snapshot releases nothing and reads no fee history',
          reads(f"public.fn_ca_promo_play_through_settle('{club}','{user}')"), '0')
    check('the grant is still open', f"SELECT closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{grant}'", 't')
    # Direction two: the cash-out is answered live, so the paid-up member is
    # NOT refused because the snapshot is old.
    allowed = leave(10, 40)
    check('a cash-out on a stale locked snapshot is answered live and allowed',
          f"SELECT {str(allowed.returncode == 0).lower()}", 't')
    check('the cash-out closed the met grant', f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{grant}'", 'met')

    # A snapshot that says "met" can never release: the release itself is
    # decided on the live fee history, and so is the cash-out.
    key2 = str(uuid.uuid4())
    db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{club}' AND user_id='{user}';"
           f"SELECT fn_ca_promo_play_through_record_grant('{club}','{user}',50,'club_promo','{key2}',NULL,'promo_wallet','{club}',NULL);")
    grant2 = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key2}'")
    check('a new grant changes the account structure, so the old snapshot is not used',
          f"SELECT fn_ca_promo_fee_state_is_current('{club}','{user}')", 'f')
    check('the new grant is locked the moment it exists', locked, '50')
    paid = fee(db.one(f"SELECT fee_target FROM ca_promo_play_through_grants WHERE id='{grant2}'"))
    db.run(f"SELECT fn_ca_promo_fee_state_refresh('{club}','{user}')")
    check('the snapshot now says the second grant is met',
          f"SELECT principal_state FROM fn_ca_promo_shared_fee_state('{club}','{user}') WHERE grant_id='{grant2}' AND phase_kind='gift'", 'met_pending')
    # The fee is reversed after the snapshot was taken.
    db.run(f"ALTER TABLE rake_attributions DISABLE TRIGGER USER;DELETE FROM rake_attributions WHERE hand_id='{paid}';ALTER TABLE rake_attributions ENABLE TRIGGER USER;")
    check('the snapshot still says met after the fee is gone',
          f"SELECT principal_state FROM fn_ca_promo_shared_fee_state('{club}','{user}') WHERE grant_id='{grant2}' AND phase_kind='gift'", 'met_pending')
    check('the live fee history no longer supports the release',
          f"SELECT principal_state FROM fn_ca_promo_shared_fee_state_live('{club}','{user}') WHERE grant_id='{grant2}' AND phase_kind='gift'", 'locked')
    db.run(f"SELECT fn_ca_promo_play_through_settle('{club}','{user}');SELECT fn_ca_promo_profit_settle('{club}','{user}');")
    check('a settle that saw "met" in the snapshot decided on the live history and released nothing',
          f"SELECT closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{grant2}'", 't')
    refused = leave(10, 40)
    check('a cash-out on a stale met snapshot is answered live and refused',
          f"SELECT {str(refused.returncode != 0 and 'promo_play_through_locked' in refused.stderr).lower()}", 't')
    check('the refused cash-out moved nothing',
          f"SELECT chip_balance FROM club_members WHERE club_id='{club}' AND user_id='{user}'", '50')

    # The hourly sweep: looks without locking, acts only on the live answer.
    db.run("CREATE OR REPLACE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT false'")
    db.run(f"DELETE FROM ca_promo_profit_sweep_state;CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('the sweep looked at the account and reported no error',
          f"SELECT count(*)||':'||count(last_error) FROM ca_promo_profit_sweep_state WHERE club_id='{club}' AND user_id='{user}'", '1:0')
    check('the sweep released nothing that the live history does not support',
          f"SELECT closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{grant2}'", 't')
    fee(db.one(f"SELECT fee_target FROM ca_promo_play_through_grants WHERE id='{grant2}'"))
    db.run(f"DELETE FROM ca_promo_profit_sweep_state;CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('the sweep closes a grant whose fees are paid', f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{grant2}'", 'met')
    # A busy account is skipped, never waited for, and never errors a movement.
    db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{club}' AND user_id='{user}';")
    key3 = str(uuid.uuid4())
    db.run(f"SELECT fn_ca_promo_play_through_record_grant('{club}','{user}',50,'club_promo','{key3}',NULL,'promo_wallet','{club}',NULL);")
    grant3 = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key3}'")
    fee(db.one(f"SELECT fee_target FROM ca_promo_play_through_grants WHERE id='{grant3}'"))
    import subprocess, time
    holder = subprocess.Popen(["psql", "-X", "-q", "-h", db.socket, "-p", db.port, "-U", "postgres", "-d", db.name, "-c",
        f"BEGIN;SELECT 1 FROM ca_promo_play_through_grants WHERE id='{grant3}' FOR UPDATE;SELECT pg_sleep(6);COMMIT;"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    started = time.time()
    db.run(f"DELETE FROM ca_promo_profit_sweep_state;CALL sp_ca_promo_profit_hourly_sweep(60);")
    waited = time.time() - started
    check('the sweep does not wait for a grant row a movement holds', f"SELECT {str(waited < 3).lower()}", 't')
    check('the busy account is left for the next run',
          f"SELECT (SELECT closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{grant3}')::text||':'||(SELECT count(*) FROM ca_promo_profit_sweep_state WHERE club_id='{club}' AND user_id='{user}')", 'true:0')
    holder.wait()
    db.run("CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('the next run closes it', f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{grant3}'", 'met')
