"""Exact installed cleanup against the #9830 residue shapes (2026-11-07).

A rabbit-hunt player identity: one vacated seat at a closed table whose stack
reached the wallet through the engine's posted table_cashout ledger row, one
zero-balance player membership (agent = club owner) in a RETIRED club, one
ledger row as actor. Before the patch the door refuses it as custody; after
the patch it admits exactly that shape, removes only the retired-club player
row, and still refuses every live form of a seat and every other membership.
"""
import hashlib
import json


def qualify(root, fixture, query):
    user = '00000000-0000-4000-8000-000000000089'
    owner = '00000000-0000-4000-8000-000000000088'
    club = '00000000-0000-4000-8000-000000000087'
    table = '00000000-0000-4000-8000-000000000086'
    active_club = '00000000-0000-4000-8000-000000000085'
    email = 'ca-customization-cert-postdeploy-residue@example.invalid'
    left_at = "'2026-11-05 22:18:41.072112+00'::timestamptz"
    sig = 'public.cleanup_reserved_certification_account(uuid)'
    pred = 'public.fn_ca_certification_identity_retired(uuid)'
    spectator_patch = next((root/'supabase/migrations').glob('*_certification_cleanup_removes_the_spectator_membership.sql')).read_text()
    migration = next((root/'supabase/migrations').glob('*_certification_cleanup_counts_only_live_seats_and_leaves_a_re.sql')).read_text()

    # Bring the installed door to the exact production preimage (the
    # spectator-membership patch is the last one applied there).
    assert query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));") == 'c26eff38698d666a151ef188ef68b00d'
    query(spectator_patch)
    assert query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));") == '32fccc83b62d77ae9f23c530af591c1c', 'door preimage is not the production one'
    assert query(f"SELECT md5(pg_get_functiondef('{pred}'::regprocedure));") == 'fbaa2d123a08aca20a597b6273be73e4', 'predicate preimage is not the production one'

    # The columns and relations the live-custody test reads, exactly as the
    # production schema types them.
    query(f"""
      ALTER TABLE chip_ledger ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE table_seats ADD COLUMN table_id uuid, ADD COLUMN left_at timestamptz, ADD COLUMN stack numeric DEFAULT 0;
      CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, status text, lifecycle text, is_deleted boolean DEFAULT false);
      ALTER TABLE clubs ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active';
      CREATE TABLE guard_calls(setting text);
      CREATE FUNCTION public.fn_guard_retired_club_mutation() RETURNS trigger LANGUAGE plpgsql AS $t$
      DECLARE v_maintenance boolean := nullif(current_setting('request.jwt.claim.sub', true), '') IS NULL
                AND coalesce(current_setting('app.club_retirement_maintenance', true), '') = 'on';
      BEGIN
        INSERT INTO public.guard_calls VALUES(coalesce(current_setting('app.club_retirement_maintenance', true), ''));
        IF v_maintenance THEN RETURN COALESCE(OLD, NEW); END IF;
        IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = COALESCE(OLD.club_id, NEW.club_id) AND c.lifecycle_status = 'retired') THEN
          RAISE EXCEPTION 'CLUB_RETIRED: gameplay and cashier records are read-only' USING ERRCODE = '55000';
        END IF;
        RETURN COALESCE(OLD, NEW);
      END $t$;
      INSERT INTO auth.users(id,email) VALUES('{user}','{email}'),('{owner}','residue-owner@example.invalid');
      INSERT INTO profiles(id,email) VALUES('{user}','{email}'),('{owner}','residue-owner@example.invalid');
      INSERT INTO users VALUES('{user}');
      INSERT INTO clubs(id,owner_id,lifecycle_status) VALUES('{club}','{owner}','retired'),('{active_club}','{owner}','active');
      INSERT INTO tables(id,club_id,status,lifecycle) VALUES('{table}','{club}','closed','closed');
      INSERT INTO club_members(club_id,user_id,role,agent_id) VALUES('{club}','{user}','player','{owner}');
      INSERT INTO table_seats(user_id,table_id,left_at,stack) VALUES('{user}','{table}',{left_at},4.05);
      CREATE TRIGGER trg_guard_retired_club_mutation BEFORE DELETE ON club_members
        FOR EACH ROW EXECUTE FUNCTION public.fn_guard_retired_club_mutation();
    """)
    query("SET request.jwt.claims='{\"role\":\"service_role\"}';"
          f"INSERT INTO chip_ledger(performed_by,amount,category,status,to_entity_id,table_id,created_at) VALUES('{user}',4,'buyin','posted',NULL,'{table}',{left_at}-interval '2 minutes');"
          f"INSERT INTO chip_ledger(performed_by,amount,category,status,to_entity_id,table_id,created_at) VALUES('{owner}',4.05,'table_cashout','posted','{user}','{table}',{left_at});")

    def call():
        return f"SELECT public.cleanup_reserved_certification_account('{user}');"

    def state():
        return query(f"SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY club_id) FROM club_members m WHERE user_id='{user}'),'seats',(SELECT jsonb_agg(to_jsonb(s)) FROM table_seats s WHERE user_id='{user}'),'auth',(SELECT to_jsonb(u) FROM auth.users u WHERE id='{user}'),'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM chip_ledger l),'clubs',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM clubs c));")

    def meta(target):
        return query(f"SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef) FROM pg_proc WHERE oid='{target}'::regprocedure;")

    snapshot = state()
    door_meta, pred_meta = meta(sig), meta(pred)
    # BEFORE: the exact production residue shape is refused as custody.
    query(call(), 'CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY')
    assert state() == snapshot
    assert query(f"SELECT public.fn_ca_certification_identity_retired('{user}');") == 'f'
    assert query(f"SELECT count(*) FROM public.fn_ca_stale_certification_accounts(now()) WHERE id='{user}';") == '1'
    print('residue-cleanup-fail-before-reproduced')

    # The patch is one transaction, reversible on refusal, replay-safe, and
    # keeps owner, ACL and configuration of both functions.
    query(migration.replace('COMMIT;', "DO $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; COMMIT;"), 'fixture rollback')
    assert query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));") == '32fccc83b62d77ae9f23c530af591c1c'
    query(migration)
    installed = query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));")
    assert installed != '32fccc83b62d77ae9f23c530af591c1c'
    assert query(f"SELECT md5(pg_get_functiondef('{pred}'::regprocedure));") != 'fbaa2d123a08aca20a597b6273be73e4'
    assert meta(sig) == door_meta and meta(pred) == pred_meta
    query(migration)  # replay is a no-op
    assert query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));") == installed
    for role in ['anon', 'authenticated']:
        query('SET ROLE ' + role + ';' + call(), 'permission denied')
        query('SET ROLE ' + role + f"; SELECT public.fn_ca_certification_identity_retired('{user}');", 'permission denied')

    # Still custody: every live form of the same seat row, and every other
    # membership shape. Each refusal leaves the fixture byte-identical.
    def refused(mutation, undo, reason='CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY'):
        query(mutation)
        before = state()
        query(call(), reason)
        assert state() == before, mutation
        query(undo)

    refused(f"UPDATE table_seats SET left_at=NULL WHERE user_id='{user}';",
            f"UPDATE table_seats SET left_at={left_at} WHERE user_id='{user}';")
    for status in ['waiting', 'running', 'paused', 'NULL']:
        refused(f"UPDATE tables SET status={status if status == 'NULL' else repr(status)} WHERE id='{table}';",
                f"UPDATE tables SET status='closed' WHERE id='{table}';")
    refused(f"UPDATE table_seats SET table_id='00000000-0000-4000-8000-000000000001' WHERE user_id='{user}';",
            f"UPDATE table_seats SET table_id='{table}' WHERE user_id='{user}';")
    refused(f"UPDATE chip_ledger SET amount=4 WHERE category='table_cashout';",
            f"UPDATE chip_ledger SET amount=4.05 WHERE category='table_cashout';")
    refused(f"UPDATE chip_ledger SET status='pending' WHERE category='table_cashout';",
            f"UPDATE chip_ledger SET status='posted' WHERE category='table_cashout';")
    refused(f"UPDATE chip_ledger SET created_at=created_at-interval '10 minutes' WHERE category='table_cashout';",
            f"UPDATE chip_ledger SET created_at=created_at+interval '10 minutes' WHERE category='table_cashout';")
    refused(f"UPDATE chip_ledger SET table_id='00000000-0000-4000-8000-000000000001' WHERE category='table_cashout';",
            f"UPDATE chip_ledger SET table_id='{table}' WHERE category='table_cashout';")
    refused(f"UPDATE clubs SET lifecycle_status='active' WHERE id='{club}';",
            f"UPDATE clubs SET lifecycle_status='retired' WHERE id='{club}';")
    for role in ['admin', 'owner', 'member', 'NULL']:
        refused(f"UPDATE club_members SET role={role if role == 'NULL' else repr(role)} WHERE user_id='{user}';",
                f"UPDATE club_members SET role='player' WHERE user_id='{user}';")
    for column in ['chip_balance', 'promo_balance', 'held_chips', 'locked_chips', 'credit_used', 'credit_limit']:
        refused(f"UPDATE club_members SET {column}=1 WHERE user_id='{user}';",
                f"UPDATE club_members SET {column}=0 WHERE user_id='{user}';")
    refused(f"UPDATE club_members SET agent_id='{user}' WHERE user_id='{user}';",
            f"UPDATE club_members SET agent_id='{owner}' WHERE user_id='{user}';")
    refused(f"UPDATE club_members SET parent_agent_id='{owner}' WHERE user_id='{user}';",
            f"UPDATE club_members SET parent_agent_id=NULL WHERE user_id='{user}';")
    refused(f"INSERT INTO club_members(club_id,user_id,role,agent_id) VALUES('{active_club}','{user}','player','{owner}');",
            f"DELETE FROM club_members WHERE club_id='{active_club}';")
    for table_name, column in [('tournament_players', 'user_id'), ('agents', 'user_id'), ('clubs', 'owner_id')]:
        refused(f"INSERT INTO {table_name}({column}) VALUES('{user}');", f"DELETE FROM {table_name} WHERE {column}='{user}';")
    query('UPDATE freeze_fixture SET active=true;')
    snapshot = state()
    assert json.loads(query(call())) == {'success': False, 'reason': 'platform_is_frozen'}
    assert state() == snapshot
    query('UPDATE freeze_fixture SET active=false;')
    print('residue-cleanup-live-custody-still-refused')

    # AFTER: the exact residue shape is admitted. Only the retired-club player
    # row goes; the seat, the closed table, the retired club and the ledger
    # are untouched; the guard saw the maintenance setting on and then
    # restored for this transaction only.
    immutable = query('SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text) FROM chip_ledger l;')
    seats = query(f"SELECT md5(jsonb_agg(to_jsonb(s))::text) FROM table_seats s WHERE user_id='{user}';")
    clubs = query('SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM clubs c;')
    lines = query('BEGIN; SET LOCAL ROLE service_role; ' + call()
                  + " SELECT coalesce(nullif(current_setting('app.club_retirement_maintenance', true), ''), 'restored'); COMMIT;").splitlines()
    result = json.loads(lines[0])
    assert result['reason'] == 'auth_soft_delete_required' and result['user_id'] == user and result['email'] == email, result
    assert lines[1] == 'restored', lines
    assert query(f"SELECT count(*) FROM club_members WHERE user_id='{user}';") == '0'
    assert query("SELECT count(*) FROM guard_calls WHERE setting='on';") == '1'
    assert query('SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text) FROM chip_ledger l;') == immutable
    assert query(f"SELECT md5(jsonb_agg(to_jsonb(s))::text) FROM table_seats s WHERE user_id='{user}';") == seats
    assert query('SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM clubs c;') == clubs
    # A late seat at a live table after the handshake still blocks retirement.
    query(f"INSERT INTO tables(id,club_id,status) VALUES('00000000-0000-4000-8000-000000000084','{active_club}','running'); INSERT INTO table_seats(user_id,table_id,left_at,stack) VALUES('{user}','00000000-0000-4000-8000-000000000084',NULL,10);")
    query(f"UPDATE auth.users SET email='deleted-{user}',encrypted_password='',deleted_at=now() WHERE id='{user}';")
    assert query(f"SELECT public.fn_ca_certification_identity_retired('{user}');") == 'f'
    assert query(f"SELECT count(*) FROM public.fn_ca_stale_certification_accounts(now()) WHERE id='{user}';") == '1'
    query(f"DELETE FROM table_seats WHERE user_id='{user}' AND left_at IS NULL; DELETE FROM tables WHERE id='00000000-0000-4000-8000-000000000084';")
    # The retired-club membership is gone and the seat is history: retired.
    assert query(f"SELECT public.fn_ca_certification_identity_retired('{user}');") == 't'
    assert json.loads(query(call()))['disposition'] == 'retained_ledger_actor'
    assert query(f"SELECT count(*) FROM public.fn_ca_stale_certification_accounts(now()) WHERE id='{user}';") == '0'
    assert meta(sig) == door_meta and meta(pred) == pred_meta
    query(f"DROP TRIGGER trg_guard_retired_club_mutation ON club_members; DROP FUNCTION public.fn_guard_retired_club_mutation();")
    print('residue-cleanup-native-acceptance-passed')
