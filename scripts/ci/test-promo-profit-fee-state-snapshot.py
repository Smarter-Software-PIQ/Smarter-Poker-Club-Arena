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

    # ── Incidents 053d3341 & 515d6f24 (2026-11-22):
    #   1. fn_ca_promo_apply_pending_cash_funding never settles or scans promo
    #      fee history inside post-commit envelopes, and never locks promo grants
    #      when the pending add-on holds zero promo custody.
    #   2. fn_ca_promo_locked_at and fn_ca_promo_leave_principal short-circuit
    #      when no open grant holds positive custody at the checked location.
    #   3. sp_ca_promo_profit_hourly_sweep refreshes the cache lock-free after
    #      ACT mutates grants/gates and repairs signature-mismatched caches
    #      without waiting for the 1-hour sweep cooldown.
    mig_205903 = ROOT / 'supabase/migrations/20261122205903_post_commit_pending_addon_never_scans_promo_history_and_swee.sql'
    u2, k_a, k_b = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    db.run(f"""INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{club}','{u2}',200,'member');
      SELECT fn_ca_promo_play_through_record_grant('{club}','{u2}',10,'club_promo','{k_a}',NULL,'promo_wallet','{club}',NULL);
      SELECT fn_ca_promo_play_through_record_grant('{club}','{u2}',10,'club_promo','{k_b}',NULL,'promo_wallet','{club}',NULL);""")
    grant_a = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{k_a}'")
    grant_b = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{k_b}'")
    target_a = db.one(f"SELECT fee_target FROM ca_promo_play_through_grants WHERE id='{grant_a}'")

    def fee_u2(amount):
        h = str(uuid.uuid4())
        db.run(f"INSERT INTO ca_promo_cash_hand_clocks VALUES('{h}','{table}',1,clock_timestamp());"
               f"INSERT INTO rake_attributions(club_id,player_id,rake_amount,hand_id) VALUES('{club}','{u2}',{amount},'{h}')")
        return h

    def seed_pending_addon(owner_uid, amount, applied_amt, refunded_amt, with_promo_custody=False):
        pid, fid, lid, seat_id, occ_id = [str(uuid.uuid4()) for _ in range(5)]
        db.run(f"""INSERT INTO table_seats(id,table_id,user_id,occupancy_id,stack)
          VALUES('{seat_id}','{table}','{owner_uid}','{occ_id}',100)
          ON CONFLICT DO NOTHING;
          INSERT INTO cash_participant_funding_receipts(
            id,recorded_at,operation_kind,operation_key,user_id,table_id,seat_id,occupancy_id,
            seat_joined_at,source_ledger_id,account_type,account_entity_id,funding_club_id,
            asset,unit_scale,amount,balance_before,balance_after,pending_addon_id)
          VALUES('{fid}',clock_timestamp(),'addon','test:{pid}','{owner_uid}','{table}','{seat_id}','{occ_id}',
            clock_timestamp(),'{lid}','player_wallet','{owner_uid}','{club}',
            'chips',2,{amount},200,{200 - amount},'{pid}');
          INSERT INTO cash_funding_application_receipts(
            pending_addon_id,funding_receipt_id,applied_at,original_occupancy_id,
            applied_occupancy_id,applied,refunded)
          VALUES('{pid}','{fid}',clock_timestamp(),'{occ_id}',
            {f"'{occ_id}'" if applied_amt > 0 else 'NULL'},{applied_amt},{refunded_amt});""")
        if with_promo_custody:
            db.run(f"""UPDATE ca_promo_principal_custody SET amount=amount-{with_promo_custody}
              WHERE grant_id='{grant_b}' AND kind='player_wallet' AND entity_id='{owner_uid}';
              INSERT INTO ca_promo_principal_custody(grant_id,kind,entity_id,amount)
              VALUES('{grant_b}','pending_addon','{pid}',{with_promo_custody});""")
        return pid

    # Load the exact production preimage of fn_ca_promo_leave_principal from
    # 20261116154841 (test-promo-profit.py only loads its sibling return helpers).
    returns_mig = next((ROOT / 'supabase/migrations').glob('20261116154841_*.sql'))
    returns_sql = returns_mig.read_text()
    leave_start = returns_sql.index('CREATE FUNCTION public.fn_ca_promo_leave_principal(')
    leave_end = returns_sql.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_leave_principal(', leave_start)
    leave_end = returns_sql.index(';', leave_end) + 1
    db.run(returns_sql[leave_start:leave_end])

    # BEFORE 20261122205903: reproduce all four defects on the pre-fix code.
    db.run(f"DELETE FROM ca_promo_fee_state_cache WHERE club_id='{club}' AND user_id='{u2}';")
    check('before fix: zero-custody fn_ca_promo_locked_at still scans fee history',
          reads(f"public.fn_ca_promo_locked_at('{club}','{u2}','table_stack','{table}')"), '1')
    p_before = seed_pending_addon(u2, 20, 0, 20)
    check('before fix: zero-custody pending add-on scans fee history inside post-commit',
          reads(f"public.fn_ca_promo_apply_pending_cash_funding('{p_before}')"), '1')
    u3, k_u3 = str(uuid.uuid4()), str(uuid.uuid4())
    db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{club}','{u3}',50,'member');"
           f"SELECT fn_ca_promo_play_through_record_grant('{club}','{u3}',10,'club_promo','{k_u3}',NULL,'promo_wallet','{club}',NULL);"
           f"UPDATE ca_promo_principal_custody SET kind='table_stack',entity_id='{table}' WHERE grant_id=(SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{k_u3}');")
    check('before fix: zero-wallet/pending-custody fn_ca_promo_leave_principal scans fee history',
          reads(f"public.fn_ca_promo_leave_principal('{club}','{u3}')"), '1')
    fee_u2(target_a)
    db.run(f"DELETE FROM ca_promo_profit_sweep_state WHERE club_id='{club}' AND user_id='{u2}';"
           f"CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('before fix: sweep closed grant_a and self-invalidated its own cache signature',
          f"SELECT (SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{grant_a}')||':'||"
          f"fn_ca_promo_fee_state_is_current('{club}','{u2}')::text", 'met:false')
    db.run("CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('before fix: second sweep skips self-invalidated account due to 1h cooldown',
          f"SELECT fn_ca_promo_fee_state_is_current('{club}','{u2}')", 'f')

    # Install 20261122205903 (verify exact production MD5 preimages & probes).
    runfile(mig_205903)

    # AFTER 20261122205903:
    # 1. Sweep immediately repairs the already-mismatched cache signature without waiting 1h!
    db.run("CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('after fix: sweep repairs signature-mismatched cache immediately within 1h cooldown',
          f"SELECT fn_ca_promo_fee_state_is_current('{club}','{u2}')", 't')

    # 2. Sweep closing one grant while another remains open leaves cache current immediately!
    k_c = str(uuid.uuid4())
    db.run(f"SELECT fn_ca_promo_play_through_record_grant('{club}','{u2}',10,'club_promo','{k_c}',NULL,'promo_wallet','{club}',NULL);")
    grant_c = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{k_c}'")
    check('new grant invalidates cache signature until next sweep tick',
          f"SELECT fn_ca_promo_fee_state_is_current('{club}','{u2}')", 'f')
    fee_u2(db.one(f"SELECT fee_target FROM ca_promo_play_through_grants WHERE id='{grant_b}'"))
    db.run("CALL sp_ca_promo_profit_hourly_sweep(60);")
    check('after fix: sweep closes grant_b and leaves cache current for surviving grant_c',
          f"SELECT (SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{grant_b}')||':'||"
          f"(SELECT closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{grant_c}')::text||':'||"
          f"fn_ca_promo_fee_state_is_current('{club}','{u2}')::text", 'met:true:true')

    # 3. Zero-custody fn_ca_promo_locked_at reads 0 fee events even with NO cache!
    db.run(f"DELETE FROM ca_promo_fee_state_cache WHERE club_id='{club}' AND user_id='{u2}';")
    check('after fix: zero-custody fn_ca_promo_locked_at scans zero fee events with missing cache',
          reads(f"public.fn_ca_promo_locked_at('{club}','{u2}','table_stack','{table}')"), '0')
    check('after fix: zero-custody fn_ca_promo_locked_at returns 0',
          f"SELECT fn_ca_promo_locked_at('{club}','{u2}','table_stack','{table}')", '0')
    check('after fix: positive-custody fn_ca_promo_locked_at still returns exact locked principal',
          f"SELECT fn_ca_promo_locked_at('{club}','{u2}','player_wallet','{u2}')", '10')

    # 4. Zero-custody pending add-on scans 0 fee events AND takes 0 grant locks!
    db.run(f"DELETE FROM ca_promo_fee_state_cache WHERE club_id='{club}' AND user_id='{u2}';")
    p_zero = seed_pending_addon(u2, 20, 0, 20)
    check('after fix: zero-custody pending add-on scans zero fee events with missing cache',
          reads(f"public.fn_ca_promo_apply_pending_cash_funding('{p_zero}')"), '0')
    grant_holder = subprocess.Popen(["psql", "-X", "-q", "-h", db.socket, "-p", db.port, "-U", "postgres", "-d", db.name, "-c",
        f"BEGIN;SELECT 1 FROM ca_promo_play_through_grants WHERE id='{grant_c}' FOR UPDATE;SELECT pg_sleep(4);COMMIT;"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    t_zero = time.time()
    db.run(f"SELECT fn_ca_promo_apply_pending_cash_funding('{p_zero}')")
    zero_dur = time.time() - t_zero
    grant_holder.wait()
    check('after fix: zero-custody pending add-on completes without waiting on a locked promo grant',
          f"SELECT ({str(zero_dur < 2.0).lower()}) AND (SELECT principal_before=0 AND principal_applied=0 AND principal_refunded=0 FROM ca_promo_pending_custody_receipts WHERE pending_addon_id='{p_zero}')", 't')

    # 5a. Promo-custody pending add-on (full refund) scans 0 fee events and conserves every cent!
    db.run(f"DELETE FROM ca_promo_fee_state_cache WHERE club_id='{club}' AND user_id='{u2}';")
    p_promo = seed_pending_addon(u2, 20, 10, 10)
    db.run(f"""BEGIN;
      UPDATE ca_promo_principal_custody SET amount=0
       WHERE grant_id='{grant_c}' AND kind='player_wallet' AND entity_id='{u2}';
      INSERT INTO ca_promo_principal_custody(grant_id,kind,entity_id,amount)
      VALUES('{grant_c}','pending_addon','{p_promo}',10);
      COMMIT;""")
    check('after fix: promo-custody pending add-on scans zero fee events inside post-commit',
          reads(f"public.fn_ca_promo_apply_pending_cash_funding('{p_promo}')"), '0')
    db.run(f"SELECT fn_ca_promo_apply_pending_cash_funding('{p_promo}')")
    check('after fix: promo-custody pending add-on conserves principal on full refund',
          f"SELECT (SELECT principal_before||':'||principal_applied||':'||principal_refunded FROM ca_promo_pending_custody_receipts WHERE pending_addon_id='{p_promo}')||'|'||"
          f"(SELECT COALESCE(sum(amount),0) FROM ca_promo_principal_custody WHERE grant_id='{grant_c}' AND kind='pending_addon' AND entity_id='{p_promo}')||'|'||"
          f"(SELECT COALESCE(sum(amount),0) FROM ca_promo_principal_custody WHERE grant_id='{grant_c}' AND kind='table_stack' AND entity_id='{table}')||'|'||"
          f"(SELECT COALESCE(sum(amount),0) FROM ca_promo_principal_custody WHERE grant_id='{grant_c}' AND kind='player_wallet' AND entity_id='{u2}')",
          '10:0:10|0|0|10')

    # 5b. Promo-custody pending add-on (partial apply + partial refund) moves exact principal to both table_stack and player_wallet with 0 fee scans!
    p_split = seed_pending_addon(u2, 20, 15, 5)
    db.run(f"""BEGIN;
      UPDATE ca_promo_principal_custody SET amount=0
       WHERE grant_id='{grant_c}' AND kind='player_wallet' AND entity_id='{u2}';
      INSERT INTO ca_promo_principal_custody(grant_id,kind,entity_id,amount)
      VALUES('{grant_c}','pending_addon','{p_split}',10);
      COMMIT;""")
    check('after fix: split promo-custody pending add-on scans zero fee events inside post-commit',
          reads(f"public.fn_ca_promo_apply_pending_cash_funding('{p_split}')"), '0')
    db.run(f"SELECT fn_ca_promo_apply_pending_cash_funding('{p_split}')")
    check('after fix: split promo-custody pending add-on conserves principal across table_stack and player_wallet',
          f"SELECT (SELECT principal_before||':'||principal_applied||':'||principal_refunded FROM ca_promo_pending_custody_receipts WHERE pending_addon_id='{p_split}')||'|'||"
          f"(SELECT COALESCE(sum(amount),0) FROM ca_promo_principal_custody WHERE grant_id='{grant_c}' AND kind='pending_addon' AND entity_id='{p_split}')||'|'||"
          f"(SELECT COALESCE(sum(amount),0) FROM ca_promo_principal_custody WHERE grant_id='{grant_c}' AND kind='table_stack' AND entity_id='{table}')||'|'||"
          f"(SELECT COALESCE(sum(amount),0) FROM ca_promo_principal_custody WHERE grant_id='{grant_c}' AND kind='player_wallet' AND entity_id='{u2}')",
          '10:5:5|0|5|5')

    # 6. Zero-custody fn_ca_promo_leave_principal scans 0 fee events even with an open grant!
    db.run(f"DELETE FROM ca_promo_fee_state_cache WHERE club_id='{club}' AND user_id='{u3}';")
    check('after fix: zero-custody fn_ca_promo_leave_principal scans zero fee events',
          reads(f"public.fn_ca_promo_leave_principal('{club}','{u3}')"), '0')

    # 7. Exact owner-only ACLs preserved across all 5 redefined routines.
    check('all 5 redefined routines remain postgres-owned and closed to anon/authenticated/service_role', """
      SELECT count(*) FROM pg_proc p
       WHERE p.oid IN (
         'public.fn_ca_promo_apply_pending_cash_funding(uuid)'::regprocedure,
         'public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)'::regprocedure,
         'public.fn_ca_promo_nonwallet_entry()'::regprocedure,
         'public.fn_ca_promo_leave_principal(uuid,uuid)'::regprocedure,
         'public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure
       )
         AND p.proowner = 'postgres'::regrole
         AND p.proacl::text = '{postgres=X/postgres}'
    """, '5')
