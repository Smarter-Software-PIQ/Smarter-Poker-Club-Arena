"""A finished owner of record leaves the stale inventory (2026-11-08).

The production shape read on 2026-11-08 (eight identities, e.g. 0f1f28e9,
owner of the retired 'Cert RH 17004387'): a reserved identity that owns one
retired club (treasury, promo, insurance and pool 0, no open table), holds one
zero-balance 'owner' membership in it and nothing else, with its password and
sessions still live. Before the patch the inventory lists it for ever. After
it, fn_ca_certification_owner_of_record_state reads it 'credentials_live'
(still listed), every live form of custody reads 'not_finished' (still
listed), and once Auth has soft-deleted it, 'retired' (no longer listed).
"""


def qualify(root, fixture, query):
    owner = '00000000-0000-4000-8000-000000000079'
    club = '00000000-0000-4000-8000-000000000078'
    table = '00000000-0000-4000-8000-000000000077'
    other_club = '00000000-0000-4000-8000-000000000076'
    email = 'ca-customization-cert-postdeploy-owner-of-record@example.invalid'
    inv = 'public.fn_ca_stale_certification_accounts(timestamptz)'
    state_fn = 'public.fn_ca_certification_owner_of_record_state(uuid)'
    migration = next((root/'supabase/migrations').glob('*_stale_certification_inventory_skips_a_finished_owner_of_reco.sql')).read_text()

    # The installed inventory is the exact production preimage.
    assert query(f"SELECT md5(pg_get_functiondef('{inv}'::regprocedure));") == 'd0ab035f530057448cc8b1b8bad3888c', 'inventory preimage is not the production one'
    query(f"""
      ALTER TABLE clubs ADD COLUMN IF NOT EXISTS chip_treasury numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS promo_balance numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS insurance_balance numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS chip_pool numeric DEFAULT 0;
      ALTER TABLE club_members ADD COLUMN IF NOT EXISTS held_chips numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS locked_chips integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS credit_used numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS credit_limit numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS agent_id uuid,
        ADD COLUMN IF NOT EXISTS parent_agent_id uuid;
      INSERT INTO auth.users(id,email) VALUES('{owner}','{email}');
      INSERT INTO profiles(id,email) VALUES('{owner}','{email}');
      INSERT INTO auth.sessions(user_id) VALUES('{owner}');
      INSERT INTO auth.refresh_tokens(user_id) VALUES('{owner}');
      INSERT INTO clubs(id,owner_id,lifecycle_status) VALUES('{club}','{owner}','retired');
      INSERT INTO tables(id,club_id,status,lifecycle) VALUES('{table}','{club}','closed','closed');
      INSERT INTO club_members(club_id,user_id,role) VALUES('{club}','{owner}','owner');
    """)
    query(f"INSERT INTO chip_ledger(performed_by,amount) VALUES('{owner}',100000);")

    def listed():
        return query(f"SELECT count(*) FROM public.fn_ca_stale_certification_accounts(now()) WHERE id='{owner}';")

    def state():
        return query(f"SELECT public.fn_ca_certification_owner_of_record_state('{owner}');")

    def soft_delete():
        query(f"UPDATE auth.users SET encrypted_password='',deleted_at=now() WHERE id='{owner}';"
              f"DELETE FROM auth.sessions WHERE user_id='{owner}'; DELETE FROM auth.refresh_tokens WHERE user_id='{owner}';")

    def meta():
        return query(f"SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef) FROM pg_proc WHERE oid='{inv}'::regprocedure;")

    # BEFORE: listed, even once Auth-retired, because nothing reads the shape.
    assert listed() == '1'
    soft_delete()
    assert listed() == '1'
    query(f"UPDATE auth.users SET encrypted_password='isolated-fixture-hash',deleted_at=NULL WHERE id='{owner}';"
          f"INSERT INTO auth.sessions(user_id) VALUES('{owner}');")
    print('owner-of-record-listed-for-ever-before-reproduced')

    # A drifted preimage refuses before any change; a refused install rolls back.
    pre = query(f"SELECT pg_get_functiondef('{inv}'::regprocedure);")
    query(pre.replace('LIMIT 21', 'LIMIT 22'))
    query(migration, 'STALE_CERTIFICATION_INVENTORY_PREIMAGE_CHANGED')
    query(pre)
    inv_meta = meta()
    query(migration.replace('COMMIT;', "DO $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; COMMIT;"), 'fixture rollback')
    assert query(f"SELECT md5(pg_get_functiondef('{inv}'::regprocedure));") == 'd0ab035f530057448cc8b1b8bad3888c'
    assert query(f"SELECT to_regprocedure('{state_fn}') IS NULL;") == 't'
    query(migration)
    installed = query(f"SELECT md5(pg_get_functiondef('{inv}'::regprocedure));")
    query(migration)  # replay is a no-op
    assert query(f"SELECT md5(pg_get_functiondef('{inv}'::regprocedure));") == installed
    assert meta() == inv_meta
    for role in ['anon', 'authenticated']:
        query(f"SET ROLE {role}; SELECT public.fn_ca_certification_owner_of_record_state('{owner}');", 'permission denied')
        query(f"SET ROLE {role}; SELECT public.fn_ca_stale_certification_accounts(now());", 'permission denied')
    assert query(f"SET ROLE service_role; SELECT public.fn_ca_certification_owner_of_record_state('{owner}');") == 'credentials_live'

    # Credentials live: still listed, so the sweep reaches it.
    assert state() == 'credentials_live' and listed() == '1'

    # Every live form of custody is 'not_finished' and stays listed.
    def not_finished(mutation, undo):
        query(mutation)
        assert state() == 'not_finished', mutation
        assert listed() == '1', mutation
        query(undo)
        assert state() == 'credentials_live', undo

    not_finished(f"UPDATE clubs SET lifecycle_status='active' WHERE id='{club}';",
                 f"UPDATE clubs SET lifecycle_status='retired' WHERE id='{club}';")
    for column in ['chip_treasury', 'promo_balance', 'insurance_balance', 'chip_pool']:
        not_finished(f"UPDATE clubs SET {column}=1 WHERE id='{club}';", f"UPDATE clubs SET {column}=0 WHERE id='{club}';")
    for status in ['running', 'waiting', 'NULL']:
        not_finished(f"UPDATE tables SET status={status if status == 'NULL' else repr(status)} WHERE id='{table}';",
                     f"UPDATE tables SET status='closed' WHERE id='{table}';")
    not_finished(f"INSERT INTO clubs(id,owner_id,lifecycle_status) VALUES('{other_club}','{owner}','active');",
                 f"DELETE FROM clubs WHERE id='{other_club}';")
    for role in ['admin', 'player', 'NULL']:
        not_finished(f"UPDATE club_members SET role={role if role == 'NULL' else repr(role)} WHERE user_id='{owner}';",
                     f"UPDATE club_members SET role='owner' WHERE user_id='{owner}';")
    for column in ['chip_balance', 'promo_balance', 'held_chips', 'locked_chips', 'credit_used', 'credit_limit']:
        not_finished(f"UPDATE club_members SET {column}=1 WHERE user_id='{owner}';",
                     f"UPDATE club_members SET {column}=0 WHERE user_id='{owner}';")
    not_finished(f"UPDATE club_members SET agent_id='{other_club}' WHERE user_id='{owner}';",
                 f"UPDATE club_members SET agent_id=NULL WHERE user_id='{owner}';")
    not_finished(f"UPDATE club_members SET parent_agent_id='{other_club}' WHERE user_id='{owner}';",
                 f"UPDATE club_members SET parent_agent_id=NULL WHERE user_id='{owner}';")
    not_finished(f"INSERT INTO club_members(club_id,user_id,role) VALUES('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','{owner}','admin');",
                 f"DELETE FROM club_members WHERE user_id='{owner}' AND club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';")
    not_finished(f"INSERT INTO table_seats(user_id,table_id,left_at,stack) VALUES('{owner}','{table}',NULL,5);",
                 f"DELETE FROM table_seats WHERE user_id='{owner}';")
    not_finished(f"INSERT INTO wallets(user_id,balance) VALUES('{owner}',1);", f"DELETE FROM wallets WHERE user_id='{owner}';")
    for table_name, column in [('tournament_players', 'user_id'), ('agents', 'user_id'), ('unions', 'owner_id')]:
        not_finished(f"INSERT INTO {table_name}({column}) VALUES('{owner}');", f"DELETE FROM {table_name} WHERE {column}='{owner}';")
    for column, value, undo in [('is_horse', 'true', 'false'), ('is_admin', 'true', 'false'),
                                ('role', "'god'", "'user'"), ('email', "'person@example.com'", f"'{email}'")]:
        query(f"UPDATE profiles SET {column}={value} WHERE id='{owner}';")
        assert state() == 'not_finished', column
        query(f"UPDATE profiles SET {column}={undo} WHERE id='{owner}';")
    # An identity that owns nothing is not an owner of record.
    query(f"UPDATE clubs SET owner_id=NULL WHERE id='{club}';")
    assert state() == 'not_finished'
    query(f"UPDATE clubs SET owner_id='{owner}' WHERE id='{club}';")
    print('owner-of-record-live-custody-still-listed')

    # AFTER: Auth-retired, the finished owner of record leaves the inventory
    # and nothing about the retired club changes.
    clubs = query('SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM clubs c;')
    members = query('SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY club_id, user_id)::text) FROM club_members m;')
    soft_delete()
    assert state() == 'retired' and listed() == '0'
    # A partial Auth transition is never finished.
    query(f"INSERT INTO auth.sessions(user_id) VALUES('{owner}');")
    assert state() == 'credentials_live' and listed() == '1'
    query(f"DELETE FROM auth.sessions WHERE user_id='{owner}';")
    query(f"UPDATE auth.users SET encrypted_password='x' WHERE id='{owner}';")
    assert state() == 'credentials_live' and listed() == '1'
    query(f"UPDATE auth.users SET encrypted_password='' WHERE id='{owner}';")
    # Late custody after retirement is listed again.
    query(f"UPDATE clubs SET lifecycle_status='active' WHERE id='{club}';")
    assert state() == 'not_finished' and listed() == '1'
    query(f"UPDATE clubs SET lifecycle_status='retired' WHERE id='{club}';")
    assert state() == 'retired' and listed() == '0'
    assert query('SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM clubs c;') == clubs
    assert query('SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY club_id, user_id)::text) FROM club_members m;') == members
    print('owner-of-record-native-acceptance-passed')
