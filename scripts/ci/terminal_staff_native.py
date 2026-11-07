"""Actual Node consumer + maintained zero-value departure/authorization bodies."""
import json
import re
import subprocess


def qualify(scope, setup, owner, club, request, email):
    root, run = scope['ROOT'], scope['run']
    migrations = root / 'supabase/migrations'

    def function(file, name, delimiter='$function$'):
        source = (migrations / file).read_text()
        hit = re.search(r'create(?: or replace)? function public\.' + name + r'\(', source, re.I)
        start = hit.start()
        end = source.index(delimiter + ';', source.index('AS ', start) if 'AS ' in source[start:] else start) + len(delimiter) + 1
        return re.sub(r'^create function', 'CREATE OR REPLACE FUNCTION', source[start:end], flags=re.I)

    definitions = function('20261002140203_every_money_path_declares_its_counterparty.sql', 'fn_member_leave_to_treasury')
    for name in ['20261006024809_a_seated_member_leaves_the_table_before_the_club.sql',
                 '20261006041001_a_member_can_leave_deep_stack_society.sql']:
        source = (migrations / name).read_text()
        definitions += '\n' + source[source.index('DO $do$'):source.index('$do$;') + len('$do$;')]
    definitions += '\n' + function('20260831235996_co_owner_counts_as_club_staff.sql', 'fn_club_is_staff', '$$')
    # The recorded snapshot adds explanatory comments absent from the installed
    # body. Remove only those comment lines; the strict installed-definition
    # hash below still proves every executable byte and all catalog attributes.
    union_context = function('20260827_snapshot_game_creation_access_functions.sql', 'fn_club_union_context')
    definitions += '\n' + re.sub(r'(?m)^  --[^\n]*\n', '', union_context)
    definitions += '\n' + function('20261002152925_club_retirement_safe_unwind.sql', 'fn_can_create_games')
    definitions += '\n' + function('20260917113717_the_finish_lane_is_exclusive_among_finishes.sql', 'fn_ca_lock_settlement_lane_global')
    definitions += '\n' + function('20260922153234_one_club_membership_cap_one_count_one_lock.sql', 'fn_club_membership_lock', '$$')
    definitions += '\n' + function('20260830010000_cashier_integrity_and_wallet_launcher.sql', 'lock_club_cashier_hierarchy_mutation')
    definitions += """
CREATE FUNCTION fn_actor_can_manage_club_treasury(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE TRIGGER staff_hierarchy BEFORE DELETE ON club_members FOR EACH ROW EXECUTE FUNCTION lock_club_cashier_hierarchy_mutation();
-- Explicit isolated wrapper port: the retained-record lifecycle core is not
-- loaded by this maintained welcome harness. Its real unwind remains real.
CREATE FUNCTION fn_retire_settled_club(p_club uuid,p_name text,p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND owner_id=auth.uid() AND name=p_name)
 THEN RAISE EXCEPTION 'owner/name mismatch'; END IF;
 result:=fn_unwind_unused_first_club_welcome_package(p_club,gen_random_uuid());
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'normal unwind refused'; END IF;
 IF (SELECT chip_treasury FROM clubs WHERE id=p_club) IS DISTINCT FROM 100000::numeric
 OR (SELECT main_balance FROM bbj_pools WHERE club_id=p_club) IS DISTINCT FROM 0::numeric
 OR (SELECT balance FROM spin_bonus_pools WHERE club_id=p_club) IS DISTINCT FROM 0::numeric
 OR (SELECT is_active FROM spin_bonus_pools WHERE club_id=p_club) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'actual funded seed return missing in Node consumer'; END IF;
 UPDATE clubs SET lifecycle_status='retired' WHERE id=p_club;
 RETURN jsonb_build_object('success',true,'records_retained',true);
END$$;
CREATE FUNCTION fixture_lock_held(key bigint) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
 AND classid=((key>>32)&4294967295)::oid AND objid=(key&4294967295)::oid AND objsubid=1)$$;
CREATE FUNCTION fixture_staff_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; BEGIN
 IF OLD.user_id=auth.uid() AND OLD.role='admin' THEN
  IF NOT fixture_lock_held(hashtextextended(OLD.user_id::text,77431))
   OR NOT fixture_lock_held(hashtextextended('ca:tournament-terminal-settlement:v1',0))
   OR NOT fixture_lock_held(hashtextextended('ca:hand-settlement-barrier:v1',0))
  THEN RAISE EXCEPTION 'maintained lanes missing before member delete'; END IF;
  FOR target IN SELECT id FROM clubs WHERE id IN(
   'a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',
   'fade0000-0000-0000-0000-000000000001','d6c9b170-0000-4000-8000-000000000002') LOOP
   IF NOT fixture_lock_held(hashtextextended('cashier-hierarchy:'||target::text,0))
   THEN RAISE EXCEPTION 'hierarchy missing before member delete'; END IF;
  END LOOP;
  IF OLD.club_id='2a1132b9-5ba2-42e6-9f01-30a7fcffebe3' AND
   current_setting('app.deep_stack_teardown',true) IS DISTINCT FROM 'on'
  THEN RAISE EXCEPTION 'normal protected-club departure declaration missing'; END IF;
 END IF;
 RETURN OLD;
END$$;
CREATE TRIGGER zz_fixture_staff_delete BEFORE DELETE ON club_members FOR EACH ROW EXECUTE FUNCTION fixture_staff_delete_guard();
"""
    ddl = """
CREATE TABLE profiles(id uuid,email text,role text,status text,is_admin boolean DEFAULT false,is_horse boolean DEFAULT false);
CREATE TABLE unions(id uuid,owner_id uuid);
CREATE TABLE union_admins(user_id uuid,union_id uuid);
CREATE TABLE wallets(id uuid,user_id uuid,balance numeric,locked_balance numeric);
CREATE TABLE diamond_wallets(user_id uuid,balance numeric);
CREATE TABLE cashout_requests(player_id uuid,agent_id uuid,status text);
CREATE TABLE chip_requests(requester_id uuid,approver_id uuid,status text);
CREATE TABLE chip_escrow(player_id uuid,released_at timestamptz);
CREATE TABLE chip_escrow_holds(user_id uuid,status text);
ALTER TABLE club_members ADD COLUMN role text DEFAULT 'owner',ADD COLUMN status text DEFAULT 'active',
 ADD COLUMN is_active boolean DEFAULT true,ADD COLUMN membership_lifecycle_status text DEFAULT 'active',
 ADD COLUMN diamonds numeric DEFAULT 0,ADD COLUMN agent_id uuid,ADD COLUMN parent_agent_id uuid;
ALTER TABLE table_seats ADD COLUMN user_id uuid,ADD COLUMN club_id uuid;
ALTER TABLE tournament_players ADD COLUMN user_id uuid,ADD COLUMN status text;
ALTER TABLE tournament_tickets ADD COLUMN holder_id uuid,ADD COLUMN status text;
"""
    setup = setup.replace('BEGIN;\n', 'BEGIN;\n' + ddl, 1)
    setup = setup.replace('INSERT INTO auth.users VALUES', definitions + '\nINSERT INTO auth.users VALUES', 1)
    own_member = f"INSERT INTO club_members(club_id,user_id) VALUES('{club}','{owner}');"
    prepared = f"""
INSERT INTO profiles VALUES('{owner}','{email}','user','active',false,false);
INSERT INTO clubs(id,owner_id,name) VALUES
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4',gen_random_uuid(),'Prepared Kings'),
 ('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3',gen_random_uuid(),'Prepared Deep Stack'),
 ('fade0000-0000-0000-0000-000000000001',gen_random_uuid(),'Prepared Union');
INSERT INTO club_members(club_id,user_id,role) SELECT id,'{owner}','admin' FROM clubs WHERE name LIKE 'Prepared %';
"""
    setup = setup.replace(own_member, own_member + prepared, 1)
    # The original case rolls back all mutations. This second disposable case
    # commits its synthetic graph so the real Node client can consume it.
    setup = setup.replace('CREATE TEMP TABLE terminal_before', 'CREATE TABLE terminal_before')
    setup = setup[:setup.rindex('ROLLBACK; SELECT')]
    # Node must own the first funded unwind, not an already-unwound replay.
    unwind_start = setup.index('DO $x$ DECLARE result jsonb; BEGIN')
    unwind_end = setup.index('END $x$;', unwind_start) + len('END $x$;')
    setup = setup[:unwind_start] + setup[unwind_end:]

    staff = (root / 'scripts/ci/reserved-terminal-staff.sql').read_text()
    staff = staff.replace('$1::uuid', f"'{owner}'::uuid").replace('$2::uuid', f"'{club}'::uuid").replace(
        '$3::uuid[]', "ARRAY['a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3','fade0000-0000-0000-0000-000000000001']::uuid[]")
    setup += 'CREATE TEMP VIEW staff_proof AS ' + staff + '\n'
    setup += "DO $$BEGIN IF (SELECT safe_staff_retirement FROM staff_proof) IS DISTINCT FROM true THEN RAISE EXCEPTION 'prepared staff refused'; END IF;END$$;\n"
    for mutation in ["UPDATE club_members SET chip_balance=1 WHERE role='admin'",
                     f"UPDATE club_members SET diamonds=1 WHERE user_id='{owner}'",
                     f"UPDATE club_members SET held_chips=1 WHERE user_id='{owner}'",
                     f"INSERT INTO union_admins VALUES('{owner}',gen_random_uuid())",
                     f"INSERT INTO chip_escrow_holds VALUES('{owner}','held')",
                     f"INSERT INTO club_members(club_id,user_id,role) VALUES(gen_random_uuid(),'{owner}','admin')"]:
        setup += "SAVEPOINT unsafe;" + mutation + ";DO $$BEGIN IF (SELECT safe_staff_retirement FROM staff_proof) IS DISTINCT FROM false THEN RAISE EXCEPTION 'unsafe staff accepted'; END IF;END$$;ROLLBACK TO unsafe;\n"
    setup += f"INSERT INTO table_seats(user_id,club_id,left_at) VALUES('{owner}','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',now());\n"
    setup += f"""
DO $$BEGIN
 IF (SELECT chip_treasury FROM clubs WHERE id='{club}') IS DISTINCT FROM 99700::numeric
 OR (SELECT count(*) FROM club_welcome_package_receipts WHERE club_id='{club}')<>1
 OR EXISTS(SELECT 1 FROM club_welcome_reset_receipts WHERE club_id='{club}')
 OR (SELECT count(*) FROM club_welcome_package_funding WHERE club_id='{club}')<>2
 OR (SELECT sum(amount) FROM club_welcome_package_funding WHERE club_id='{club}' AND destination='bbj_main') IS DISTINCT FROM 100::numeric
 OR (SELECT sum(amount) FROM club_welcome_package_funding WHERE club_id='{club}' AND destination='spin_reserve') IS DISTINCT FROM 200::numeric
 OR (SELECT main_balance FROM bbj_pools WHERE club_id='{club}') IS DISTINCT FROM 100::numeric
 OR (SELECT balance FROM spin_bonus_pools WHERE club_id='{club}') IS DISTINCT FROM 200::numeric
 THEN RAISE EXCEPTION 'Node producer is not the pristine funded welcome branch'; END IF;
END$$;
"""
    setup += "CREATE TABLE prepared_treasury_before AS SELECT id,chip_treasury FROM clubs WHERE name LIKE 'Prepared %';COMMIT;SELECT 'prepared three-admin producer ready';"
    run('terminal-staff-native-producer', setup, 'prepared three-admin producer ready')
    run('terminal-staff-native-installed-authorities', """
SELECT CASE WHEN count(*)=6 AND bool_and(md5(pg_get_functiondef(oid))=CASE proname
 WHEN 'fn_member_leave_to_treasury' THEN '4789ec1ec413959098416312831c96ed'
 WHEN 'fn_club_is_staff' THEN 'b00e779331805a29e696cf6a71d8c486'
 WHEN 'fn_can_create_games' THEN '86c1ceac6b112bb891cbe3edb5be2291'
 WHEN 'fn_club_union_context' THEN '47f070509473bacf3db38573d89cd904'
 WHEN 'fn_club_membership_lock' THEN '07343122ba0f2fa43bfb879184d56be9'
 WHEN 'fn_ca_lock_settlement_lane_global' THEN '7c759bb7a639c3124de2607bdbf12577' END) THEN 't' ELSE json_object_agg(proname,md5(pg_get_functiondef(oid)))::text END
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
 'fn_member_leave_to_treasury','fn_club_is_staff','fn_can_create_games','fn_club_union_context',
 'fn_club_membership_lock','fn_ca_lock_settlement_lane_global');
""", 't')
    config = {'host': str(scope['socket']), 'port': 55479, 'user': 'postgres', 'database': 'postgres'}
    record = {'id': owner, 'email': email, 'templateFixtureRequest': {'clubId': club, 'requestId': request}}
    js = f"""
import pg from './node_modules/pg/lib/index.js';
import {{ retireTerminalWelcomeFixture }} from './scripts/ci/reserved-terminal-welcome-fixture.mjs';
const client=new pg.Client({json.dumps(config)});await client.connect();
try {{ await client.query('BEGIN');
 await client.query("SET LOCAL app.club_retirement_maintenance='on'");
 const result=await retireTerminalWelcomeFixture({{client,clubId:{json.dumps(club)},account:{json.dumps(record)},reason:'isolated-native'}});
 if(result.prepared_staff_clubs_retired.length!==3) throw Error('three prepared grants not retired');
 await client.query('COMMIT');console.log('actual Node terminal staff consumer passed');
}} catch(error) {{await client.query('ROLLBACK');throw error;}} finally {{await client.end();}}
"""
    result = subprocess.run(['node', '--input-type=module', '-e', js], cwd=root, env=scope['env'], text=True, capture_output=True, timeout=60)
    (scope['out'] / 'terminal-staff-native-consumer.log').write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError('actual terminal staff consumer: ' + result.stderr)
    scope['results']['cases'].append({'name': 'actual-terminal-staff-node-consumer', 'passed': True})
    run('terminal-staff-native-durable-readback', f"""
SELECT (SELECT count(*) FROM club_members WHERE user_id='{owner}')=1,
 (SELECT role='owner' FROM club_members WHERE user_id='{owner}'),
 (SELECT lifecycle_status='retired' FROM clubs WHERE id='{club}'),
 NOT EXISTS(SELECT 1 FROM prepared_treasury_before old JOIN clubs c USING(id) WHERE c.chip_treasury IS DISTINCT FROM old.chip_treasury),
 (SELECT count(*) FROM table_seats WHERE user_id='{owner}' AND left_at IS NOT NULL)=1,
 NOT EXISTS(SELECT 1 FROM terminal_before old LEFT JOIN tournaments t ON t.id=old.id
 LEFT JOIN tables b ON b.id=old.table_id LEFT JOIN tournament_cancellation_receipts r ON r.tournament_id=t.id
 WHERE t.id IS NULL OR b.id IS NULL OR t.ended_at IS DISTINCT FROM old.ended_at OR b.status IS DISTINCT FROM old.status
 OR b.lifecycle IS DISTINCT FROM old.lifecycle OR b.terminal_closed_at IS DISTINCT FROM old.terminal_closed_at OR to_jsonb(r) IS DISTINCT FROM old.receipt);
""", 't|t|t|t|t|t')
