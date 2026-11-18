"""Native original-envelope, live lock-order and legacy funded wager cases."""
import json


def prove_legacy_wager_projection(root, migrations, run, spawn, finish, check, definition, club, table, player):
    db = 'legacy_wager'
    run('postgres', f'CREATE DATABASE {db}')
    sql = lambda query: run(db, query)
    sql((root / 'scripts/ci/fixtures/legacy-wager-projection.sql').read_text())
    for file, fn in [
        ('20261001160611_a_balance_never_moves_without_its_ledger_row.sql', 'promo_apply_playthrough'),
        ('20261109234320_prove_all_original_posthand_pending_escrow_completions.sql', 'fn_ca_process_hand_post_commit_obligations'),
        ('20260908043400_post_commit_obligations_are_atomic_and_resumable.sql', 'trg_finish_hand_post_commit_obligations'),
    ]:
        sql(definition(file, fn))
    # This original was installed from the quoted DDL in the protected migration.
    prior = next(migrations.glob('20261019194410_*.sql')).read_text().split('$projection$')[1]
    sql(prior)
    sql(run('proj', "SELECT pg_get_functiondef('fn_project_hand_side_effects(uuid)'::regprocedure)"))
    sql("""
CREATE TRIGGER a0_finish_hand_post_commit_obligations BEFORE DELETE ON hand_projection_outbox
FOR EACH ROW EXECUTE FUNCTION trg_finish_hand_post_commit_obligations();
REVOKE ALL ON FUNCTION promo_apply_playthrough(uuid,uuid,numeric),
  fn_ca_process_hand_post_commit_obligations(uuid) FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION promo_apply_playthrough(uuid,uuid,numeric),
  fn_ca_process_hand_post_commit_obligations(uuid) TO service_role;
""")
    sql(f"""INSERT INTO clubs VALUES('{club}','chips');
INSERT INTO tables VALUES('{table}','{club}',NULL);
INSERT INTO profiles VALUES('{player}');
INSERT INTO club_members(club_id,user_id) VALUES('{club}','{player}');
INSERT INTO player_stats(id,user_id,club_id) VALUES(gen_random_uuid(),'{player}','{club}');""")

    def hand(n, wagers, with_outbox=True):
        hand_id = f'13000000-0000-0000-0000-{n:012}'
        payload = {'promo_playthrough': [{'user_id': player, 'club_id': club, 'wagered': w} for w in wagers],
                   'rake': {'amount': 1, 'club_id': club}, 'insurance': [], 'time_banks': [],
                   'bbj_contribution': None, 'pending_addons': None}
        data = json.dumps(payload)
        sql(f"""INSERT INTO hand_history VALUES('{hand_id}','{table}',{n},now(),'[]','[]','[]',NULL,2);
INSERT INTO hand_atomic_commits(hand_id,table_id,hand_number,post_commit_payload,post_commit_payload_hash)
SELECT '{hand_id}','{table}',{n},p,encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex') FROM (VALUES('{data}'::jsonb)) x(p);
""" + (f"INSERT INTO hand_projection_outbox VALUES('{hand_id}','{table}',{n});" if with_outbox else ''))
        return hand_id

    def finance(h):
        return f"SELECT fn_ca_process_hand_post_commit_obligations('{h}')"

    def project(h):
        return f"SELECT fn_project_hand_side_effects('{h}')"

    def loss():
        return sql(f"SELECT total_losses FROM player_stats WHERE user_id='{player}' AND club_id='{club}'")

    def member():
        return sql(f"SELECT concat_ws('|',chip_balance,promo_balance,promo_playthrough_required,promo_wagered) FROM club_members WHERE user_id='{player}'")

    def blocked(p, query):
        p.stdin.write("BEGIN; SELECT user_id FROM player_stats FOR UPDATE; \\echo LOCKED\n")
        p.stdin.flush()
        while True:
            line = p.stdout.readline()
            if 'LOCKED' in line:
                break
            if not line:
                raise RuntimeError(p.stderr.read())
        contender = spawn(db, f"SET statement_timeout='300ms'; {query};\n")
        return finish(contender)

    def unlock(p):
        p.stdin.write("ROLLBACK;\n")
        p.stdin.flush()
        finish(p)

    # An old completed receipt whose projection survives the installation.
    old = hand(1, [3.25])
    check('old standalone financial completion includes the original stat',
          json.loads(sql(finance(old)))['ok'] and loss() == '3.25')
    interrupted = hand(2, [1.005, 2.005])
    holder = spawn(db)
    try:
        old_fail = blocked(holder, finance(interrupted))
        check('before cutover a locked stat times out the financial hand',
              old_fail[0] != 0 and 'statement timeout' in old_fail[2])
        check('failed original shared rake credit rolled back',
              sql('SELECT amount FROM shared_wallet') == '1')
    finally:
        unlock(holder)

    # Install the same enabled money-registration and privileged-function
    # event guards as production. Existing public function locks are immutable.
    money = json.loads((root / 'scripts/ci/fixtures/satellite-qualifiers/current-money-ddl-guard-20260917.json').read_text())
    guard = json.loads((root / 'scripts/ci/fixtures/tournament-cancellation-lane/hold-reader/installed-preimage.json').read_text())
    sql("""CREATE TABLE ca_money_rpc_registry(proname text PRIMARY KEY,status text,notes text);
INSERT INTO ca_money_rpc_registry VALUES('promo_apply_playthrough','approved','original'),
 ('fn_ca_process_hand_post_commit_obligations','approved','original');
CREATE TABLE privileged_function_lock(function_signature text PRIMARY KEY,security_definer boolean NOT NULL,
 reason text NOT NULL,locked_at timestamptz DEFAULT now());
INSERT INTO privileged_function_lock(function_signature,security_definer,reason) VALUES
 ('public.promo_apply_playthrough(uuid, uuid, numeric)',false,'original'),
 ('public.fn_ca_process_hand_post_commit_obligations(uuid)',true,'original');
""")
    for item in money['functions']:
        sql(item['definition'])
    protected = next(f for f in guard['functions'] if f['signature'] == 'fn_autorevoke_privileged_anon()')
    sql(protected['definition'])
    sql("""CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
EXECUTE FUNCTION fn_ca_money_rpc_registry_guard();
CREATE EVENT TRIGGER trg_autorevoke_privileged_anon ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION','ALTER FUNCTION','GRANT')
EXECUTE FUNCTION fn_autorevoke_privileged_anon();""")
    migration = next(migrations.glob('20261118010500_*.sql'))
    sql(migration.read_text())
    check('original financial registry approvals and public privilege locks survive enabled DDL guards',
          sql("SELECT count(*)=2 AND bool_and(status='approved' AND notes='original') FROM ca_money_rpc_registry") == 't'
          and sql("SELECT count(*)=2 AND bool_and(reason='original') FROM privileged_function_lock") == 't')
    check('new financial-only helper and original public RPC are service-only',
          sql("""SELECT has_function_privilege('service_role','public.promo_apply_playthrough(uuid,uuid,numeric)','EXECUTE')
              AND NOT has_function_privilege('authenticated','public.promo_apply_playthrough(uuid,uuid,numeric)','EXECUTE')
              AND NOT has_function_privilege('authenticated','smarter_private.apply_legacy_member_wager(uuid,uuid,numeric)','EXECUTE')
              AND NOT has_function_privilege('service_role','smarter_private.credit_original_hand_wagers()','EXECUTE')""") == 't')
    check('pre-cutover completed hand projects without repeating its original losses',
          json.loads(sql(project(old)))['ok'] and loss() == '3.25')
    holder = spawn(db)
    try:
        fresh = blocked(holder, finance(interrupted))
        check('post-cutover same frozen original completes with the stats row still locked',
              fresh[0] == 0 and json.loads(fresh[1])['wager_stats_owner'] == 'hand_projection_outbox', fresh)
        check('other session can claim the shared wallet before projection',
              sql("BEGIN; SET LOCAL lock_timeout='200ms'; SELECT amount FROM shared_wallet FOR UPDATE; ROLLBACK") == '2')
        wait = spawn(db, f"SET statement_timeout='300ms'; {project(interrupted)};\n")
        retry = finish(wait)
        check('late reporting timeout retains the exact outbox and the published finance receipt',
              retry[0] != 0 and 'statement timeout' in retry[2] and
              sql(f"SELECT EXISTS(SELECT FROM hand_projection_outbox WHERE hand_id='{interrupted}')") == 't')
    finally:
        unlock(holder)
    check('retried projection adds independently rounded original elements exactly once',
          json.loads(sql(project(interrupted)))['ok'] and loss() == '6.27')
    check('replayed old and new originals never add a second loss or rake',
          json.loads(sql(finance(interrupted)))['already_completed'] and
          json.loads(sql(project(interrupted)))['reason'] == 'not_pending' and loss() == '6.27'
          and sql('SELECT amount FROM shared_wallet') == '2')
    # Future funded bonuses retain a partial wager, the exact threshold release,
    # both original economic records, and the standalone RPC's reporting.
    sql("UPDATE club_members SET promo_balance=12.45,promo_playthrough_required=6")
    funded = hand(3, [2])
    json.loads(sql(finance(funded)))
    check('funded accepted hand advances its original bonus before projection',
          member() == '0|12.45|6|2' and loss() == '6.27')
    sql(project(funded))
    rpc = f"SELECT promo_apply_playthrough('{club}','{player}',4)"
    check('standalone RPC publishes its original report and fractional ledger release immediately',
          json.loads(sql(rpc))['released'] == 12.45 and loss() == '12.27'
          and sql("SELECT count(*)=1 AND sum(amount)=12.45 FROM chip_ledger WHERE category='promo_release'") == 't'
          and sql("SELECT count(*)=1 AND sum(amount)=12.45 FROM chip_transactions WHERE transaction_type='promo_released'") == 't'
          and member() == '12.45|0|0|0')
    no_claim = hand(4, [2.5], with_outbox=False)
    check('legacy source missing an outbox retains synchronous reporting on original completion',
          'wager_stats_owner' not in json.loads(sql(finance(no_claim))) and loss() == '14.77')
    check('unauthorized and nonpositive standalone calls still refuse without a write',
          json.loads(sql("SET test.claim='authenticated';"+rpc))['reason'] == 'engine_only' and
          json.loads(sql(f"SELECT promo_apply_playthrough('{club}','{player}',0)"))['reason'] == 'no_wager'
          and loss() == '14.77')

    # A refusal after writing the ledger rolls finance back atomically. Retrying
    # the same unchanged frozen wager can release exactly once on the hand path.
    sql("""UPDATE club_members SET promo_balance=4.55,promo_playthrough_required=1.50;
CREATE FUNCTION refuse_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('test.refuse_release',true)='on' THEN RAISE EXCEPTION 'fixture release refusal'; END IF; RETURN NEW; END $$;
CREATE TRIGGER refuse_release BEFORE INSERT ON chip_transactions FOR EACH ROW EXECUTE FUNCTION refuse_release();""")
    release = hand(5, [1.5])
    refused = finish(spawn(db, "SET test.refuse_release='on';"+finance(release)+";\n"))
    check('a refused funded hand rolls back its financials before it can publish reporting ownership',
          refused[0] != 0 and 'fixture release refusal' in refused[2] and
          member() == '12.45|4.55|1.50|0' and
          sql(f"SELECT post_commit_completed_at IS NULL AND post_commit_result IS NULL FROM hand_atomic_commits WHERE hand_id='{release}'") == 't'
          and sql('SELECT count(*) FROM chip_ledger') == '1' and loss() == '14.77')
    json.loads(sql(finance(release)))
    check('same funded hand releases its exact fractional principal before its stat is projected',
          member() == '17.00|0|0|0' and loss() == '14.77' and
          sql("SELECT count(*)=2 AND sum(amount)=17 FROM chip_ledger WHERE category='promo_release'") == 't'
          and sql("SELECT count(*)=2 AND sum(amount)=17 FROM chip_transactions WHERE transaction_type='promo_released'") == 't')
    invalid = finish(spawn(db, f"""BEGIN;
UPDATE hand_atomic_commits SET post_commit_payload=jsonb_set(post_commit_payload,'{{promo_playthrough,0,wagered}}','999')
WHERE hand_id='{release}'; {project(release)}; COMMIT;\n"""))
    check('a changed frozen amount cannot consume its outbox or write a second set of totals',
          invalid[0] != 0 and 'envelope hash mismatch' in invalid[2] and loss() == '14.77' and
          sql(f"SELECT EXISTS(SELECT FROM hand_projection_outbox WHERE hand_id='{release}')") == 't')
    first = spawn(db)
    try:
        first.stdin.write(f"BEGIN; {project(release)}; \\echo PROJECTED\n")
        first.stdin.flush()
        while True:
            line = first.stdout.readline()
            if 'PROJECTED' in line:
                break
            if not line:
                raise RuntimeError(first.stderr.read())
        other = spawn(db, project(release)+";\n")
        first.stdin.write("COMMIT;\n")
        first.stdin.flush()
        winner, replay = finish(first), finish(other)
    finally:
        if first.poll() is None:
            first.terminate()
    check('concurrent projection and repeated finance share one original stat and one funded release',
          winner[0] == replay[0] == 0 and json.loads(replay[1])['reason'] == 'not_pending' and
          json.loads(sql(finance(release)))['already_completed'] and loss() == '16.27' and member() == '17.00|0|0|0'
          and sql('SELECT count(*) FROM chip_ledger') == '2')

    deleted = hand(6, [1])
    sql(finance(deleted))
    sql(f"DELETE FROM profiles WHERE id='{player}'")
    check('a deleted profile remains deleted and its cascade cannot wedge the original projector',
          json.loads(sql(project(deleted)))['ok'] and sql('SELECT count(*) FROM player_stats') == '0')
