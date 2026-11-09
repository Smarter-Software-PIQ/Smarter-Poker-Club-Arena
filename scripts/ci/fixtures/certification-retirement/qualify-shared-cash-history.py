"""Real reserved actor retirement from a shared cash table, with exact receipts."""
import json


def qualify(root, fixture, query):
    user = '00000000-0000-4000-8000-000000000078'
    owner = '00000000-0000-4000-8000-000000000077'
    table = '00000000-0000-4000-8000-000000000076'
    seat = '00000000-0000-4000-8000-000000000075'
    occupancy = '00000000-0000-4000-8000-000000000074'
    other = '00000000-0000-4000-8000-000000000073'
    club = 'fade0000-0000-0000-0000-000000000001'
    email = 'ca-customization-cert-postdeploy-sharedcash@example.invalid'
    sig = 'public.cleanup_reserved_certification_account(uuid)'
    pred = 'public.fn_ca_certification_identity_retired(uuid)'
    migration = next((root/'supabase/migrations').glob('*_certification_retirement_accepts_an_exact_shared_cash_seat_*.sql')).read_text()
    query(f"""
      ALTER TABLE table_seats ADD COLUMN occupancy_id uuid, ADD COLUMN seat_number integer;
      ALTER TABLE tables ADD COLUMN tournament_id uuid;
      CREATE TABLE seat_cashout_receipts(occupancy_id uuid PRIMARY KEY,user_id uuid,table_id uuid,seat_id uuid,seat_number integer,receipt jsonb,created_at timestamptz DEFAULT now());
      CREATE TABLE cash_player_session(player_id uuid,closed_at timestamptz);
      CREATE TABLE lightning_pool_session(player_id uuid,exited_at timestamptz);
      CREATE TABLE lightning_reservation(player_id uuid,state text);
      CREATE TABLE seat_departure_requests(user_id uuid);
      INSERT INTO auth.users(id,email) VALUES('{user}','{email}');
      INSERT INTO profiles(id,email) VALUES('{user}','{email}');
      INSERT INTO users VALUES('{user}');
      INSERT INTO clubs(id,owner_id,lifecycle_status) VALUES('{club}','{owner}','active') ON CONFLICT (id) DO NOTHING;
      INSERT INTO tables(id,club_id,status,lifecycle) VALUES('{table}','{club}','running','live');
      INSERT INTO club_members(club_id,user_id,role) VALUES('{club}','{user}','player');
      INSERT INTO table_seats(id,user_id,table_id,left_at,stack,occupancy_id,seat_number)
        VALUES('{seat}','{user}','{table}',now(),400,'{occupancy}',1);
      SET request.jwt.claims='{{"role":"service_role"}}';
      INSERT INTO chip_ledger(performed_by,amount,category,status,to_entity_id,table_id)
        VALUES('{user}',400,'table_cashout','posted','{user}','{table}');
      INSERT INTO seat_cashout_receipts(occupancy_id,user_id,table_id,seat_id,seat_number,receipt)
        VALUES('{occupancy}','{user}','{table}','{seat}',1,
          jsonb_build_object('ok',true,'credited',true,'tournament_table',false,'stack',400,
            'user_id','{user}','table_id','{table}','seat_number',1,'occupancy_id','{occupancy}',
            'idempotency_key','cashout:occupancy:{occupancy}'));
    """)

    def call():
        return f"SELECT public.cleanup_reserved_certification_account('{user}');"

    def state():
        return query(f"SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY club_id) FROM club_members m WHERE user_id='{user}'),'seats',(SELECT jsonb_agg(to_jsonb(s)) FROM table_seats s WHERE user_id='{user}'),'auth',(SELECT to_jsonb(u) FROM auth.users u WHERE id='{user}'),'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM chip_ledger l),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tables t),'clubs',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM clubs c));")

    def meta(target):
        return query(f"SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef,'volatility',provolatile) FROM pg_proc WHERE oid='{target}'::regprocedure;")

    assert query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));") == 'b5726d7e1d42b04a87b880cafd786e9e'
    assert query(f"SELECT md5(pg_get_functiondef('{pred}'::regprocedure));") == '06cbde5561c16d8dafa18e36f04fece9'
    before = state()
    metadata = [meta(sig),meta(pred)]
    query(call(), 'CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY')
    assert state() == before
    print('shared-cash-history-fail-before-reproduced')
    query(migration.replace('COMMIT;', "DO $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; COMMIT;"), 'fixture rollback')
    assert query(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));") == 'b5726d7e1d42b04a87b880cafd786e9e'
    query(migration)
    assert [meta(sig),meta(pred)] == metadata
    query(migration, 'SHARED_CASH_CERTIFICATION_PREIMAGE_CHANGED')

    def refused(change, undo):
        query(change)
        snapshot = state()
        query(call(), 'CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY')
        assert state() == snapshot
        query(undo)

    for column, value in [('occupancy_id',other),('seat_id',other),('user_id',other),('table_id',other)]:
        original = {'occupancy_id':occupancy,'seat_id':seat,'user_id':user,'table_id':table}[column]
        refused(f"UPDATE seat_cashout_receipts SET {column}='{value}';", f"UPDATE seat_cashout_receipts SET {column}='{original}';")
    refused('UPDATE seat_cashout_receipts SET seat_number=2;', 'UPDATE seat_cashout_receipts SET seat_number=1;')
    for key, value, original in [('ok',False,True),('credited',False,True),('tournament_table',True,False),('stack',399,400),('seat_number',2,1),('occupancy_id',other,occupancy),('user_id',other,user),('table_id',other,table),('idempotency_key','wrong','cashout:occupancy:'+occupancy)]:
        encoded = lambda v: "'"+json.dumps(v)+"'::jsonb"
        refused(f"UPDATE seat_cashout_receipts SET receipt=jsonb_set(receipt,'{{{key}}}',{encoded(value)});", f"UPDATE seat_cashout_receipts SET receipt=jsonb_set(receipt,'{{{key}}}',{encoded(original)});")
    refused("UPDATE seat_cashout_receipts SET receipt=receipt-'credited';", "UPDATE seat_cashout_receipts SET receipt=receipt||'{\"credited\":true}'::jsonb;")
    refused(f"UPDATE table_seats SET occupancy_id=NULL WHERE id='{seat}';",f"UPDATE table_seats SET occupancy_id='{occupancy}' WHERE id='{seat}';")
    refused(f"UPDATE table_seats SET left_at=NULL WHERE id='{seat}';",f"UPDATE table_seats SET left_at=now() WHERE id='{seat}';")
    refused(f"UPDATE tables SET tournament_id='{other}' WHERE id='{table}';",f"UPDATE tables SET tournament_id=NULL WHERE id='{table}';")
    refused(f"UPDATE table_seats SET table_id='{other}' WHERE id='{seat}';",f"UPDATE table_seats SET table_id='{table}' WHERE id='{seat}';")
    for relation,column,extra in [('cash_player_session','player_id',''),('lightning_pool_session','player_id',''),('lightning_reservation','player_id',",state"),('seat_departure_requests','user_id','')]:
        values = f"'{user}'" + (",'pending'" if extra else '')
        refused(f"INSERT INTO {relation}({column}{extra}) VALUES({values});",f"DELETE FROM {relation} WHERE {column}='{user}';")
    refused(f"INSERT INTO lightning_reservation(player_id,state) VALUES('{user}','committed');",'DELETE FROM lightning_reservation;')
    for column,value,original in [('amount','399','400'),('status',"'pending'","'posted'"),('table_id',f"'{other}'",f"'{table}'")]:
        refused(f"UPDATE chip_ledger SET {column}={value} WHERE performed_by='{user}';",f"UPDATE chip_ledger SET {column}={original} WHERE performed_by='{user}';")
    for column in ['chip_balance','promo_balance','held_chips','locked_chips','credit_used','credit_limit']:
        refused(f"UPDATE club_members SET {column}=1 WHERE user_id='{user}';",f"UPDATE club_members SET {column}=0 WHERE user_id='{user}';")
    for role in ['anon','authenticated']:
        query('SET ROLE '+role+';'+call(),'permission denied')
    query('UPDATE freeze_fixture SET active=true;')
    frozen = state()
    assert json.loads(query(call())) == {'success':False,'reason':'platform_is_frozen'}
    assert state() == frozen
    query('UPDATE freeze_fixture SET active=false;')
    # Zero-history-wallet membership goes; all financial/seat/table records stay.
    immutable = query('SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text) FROM chip_ledger l;')
    seats = query(f"SELECT md5(jsonb_agg(to_jsonb(s))::text) FROM table_seats s WHERE user_id='{user}';")
    tables = query('SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM tables t;')
    result = json.loads(query('SET ROLE service_role;'+call()))
    assert result['reason']=='auth_soft_delete_required'
    query(f"UPDATE auth.users SET email='deleted-{user}',encrypted_password='',deleted_at=now() WHERE id='{user}';")
    assert query(f"SELECT public.fn_ca_certification_identity_retired('{user}');") == 't'
    assert json.loads(query(call()))['disposition']=='retained_ledger_actor'
    assert query(f"SELECT count(*) FROM club_members WHERE user_id='{user}';") == '0'
    assert query('SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text) FROM chip_ledger l;') == immutable
    assert query(f"SELECT md5(jsonb_agg(to_jsonb(s))::text) FROM table_seats s WHERE user_id='{user}';") == seats
    assert query('SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM tables t;') == tables
    assert [meta(sig),meta(pred)] == metadata
    print('shared-cash-history-native-acceptance-passed')
