"""Native admission regression, called by the maintained welcome qualification."""

def qualify(scope):
    root, run = scope['ROOT'], scope['run']
    owner = 'd6c9b170-0000-4000-8000-000000000001'
    club = 'd6c9b170-0000-4000-8000-000000000002'
    request = 'd6c9b170-0000-4000-8000-000000000003'
    email = 'ca-customization-cert-postdeploy-terminal-native@example.invalid'
    query = (root / 'scripts/ci/reserved-terminal-welcome-fixture.sql').read_text()
    for key, value in [('$1::uuid', f"'{club}'::uuid"), ('$2::uuid', f"'{owner}'::uuid"),
                       ('$3::text', f"'{email}'::text"), ('$4::uuid', f"'{request}'::uuid")]:
        query = query.replace(key, value)
    expected = query[:query.index('  SELECT c.id')]
    numbers = 'source_player_count source_seat_count refunded_count refund_line_count ticket_return_count zero_refund_count released_seat_count closed_table_count'.split()
    amounts = 'total_refunded total_ticket_returned fees_reversed total_rake_before total_rake_after'.split()
    arrays = 'source_player_ids source_seat_ids refunded_registration_ids ticket_return_ids zero_refund_registration_ids released_seat_ids fee_reversal_ids closed_table_ids'.split()
    columns = ','.join([f'{x} integer DEFAULT 0' for x in numbers] +
                       [f'{x} numeric DEFAULT 0' for x in amounts] +
                       [f"{x} uuid[] DEFAULT '{{}}'" for x in arrays])
    # --certification-club-scope already installs this column before loading
    # the captured current retirement guards. The historical standalone fixture
    # does not. Keep those two maintained schema modes explicit; never hide a
    # changed fixture shape behind IF NOT EXISTS.
    lifecycle_setup = '' if scope['args'].certification_club_scope else (
        "ALTER TABLE clubs ADD COLUMN lifecycle_status text DEFAULT 'active';"
    )
    setup = f"""
BEGIN;
{lifecycle_setup}
DO $shape$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.clubs'::regclass
   AND attname='lifecycle_status' AND atttypid='text'::regtype AND NOT attisdropped)
 THEN RAISE EXCEPTION 'terminal fixture lifecycle schema mismatch'; END IF;
END $shape$;
ALTER TABLE club_members ADD COLUMN held_chips numeric DEFAULT 0, ADD COLUMN locked_chips numeric DEFAULT 0,
 ADD COLUMN credit_used numeric DEFAULT 0, ADD COLUMN credit_limit numeric DEFAULT 0;
CREATE TABLE tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,receipt_version integer DEFAULT 2,
 settled_at timestamptz,receipt jsonb,{columns});
INSERT INTO auth.users VALUES('{owner}','{email}');
INSERT INTO clubs(id,owner_id,name) VALUES('{club}','{owner}','Crest Cert Terminal Native');
INSERT INTO club_members(club_id,user_id) VALUES('{club}','{owner}');
SET request.jwt.claim.sub='{owner}';
INSERT INTO club_creation_requests VALUES('{owner}','{request}','{club}');
{expected}, games AS (
 INSERT INTO tournaments(id,club_id,name,game_type,variant,tournament_type,buy_in_amount,buy_in_fee,
 max_players,min_players,table_size,starting_chips,current_players,status)
 SELECT gen_random_uuid(),'{club}',name,game_type,variant,tournament_type,buy_in_amount,buy_in_fee,
 seats,seats,seats,stack,0,'REGISTERING' FROM expected RETURNING id,name,max_players
)
INSERT INTO tables(id,club_id,tournament_id,name,game_type,status,current_players,max_players,is_deleted)
SELECT gen_random_uuid(),'{club}',id,name,'tournament','waiting',0,max_players,false FROM games;
CREATE TEMP VIEW terminal_proof AS {query};
DO $x$ BEGIN IF (SELECT safe_terminal_template FROM terminal_proof) THEN RAISE EXCEPTION 'live accepted'; END IF; END $x$;
UPDATE tournaments SET status='CANCELLED',ended_at=now() WHERE club_id='{club}';
UPDATE tables SET status='closed',lifecycle='closed',terminal_closed_at=now() WHERE club_id='{club}' AND tournament_id IS NOT NULL;
INSERT INTO tournament_cancellation_receipts(tournament_id,settled_at,closed_table_count,closed_table_ids,receipt)
 SELECT t.id,t.ended_at,1,ARRAY[b.id],jsonb_build_object('ok',true,'fully_settled',true,'status','CANCELLED','tournament_id',t.id)
 FROM tournaments t JOIN tables b ON b.tournament_id=t.id WHERE t.club_id='{club}';
DO $x$ BEGIN
 BEGIN PERFORM fn_ca_prepare_unused_welcome_certification_board_games('{club}');
 RAISE EXCEPTION 'BEFORE failure missing'; EXCEPTION WHEN SQLSTATE '55000' THEN
 IF SQLERRM<>'WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED' THEN RAISE; END IF; END;
 IF (SELECT safe_terminal_template FROM terminal_proof) IS DISTINCT FROM true THEN RAISE EXCEPTION 'terminal refused'; END IF;
END $x$;
"""
    mutations = [
        ('paid', 'UPDATE tournament_cancellation_receipts SET total_refunded=1'),
        ('seated', 'UPDATE tournament_cancellation_receipts SET source_seat_count=1'),
        ('mismatched receipt', "UPDATE tournament_cancellation_receipts SET receipt=jsonb_set(receipt,'{tournament_id}','\"wrong\"')"),
        ('foreign table', "UPDATE tables SET club_id=NULL WHERE tournament_id IS NOT NULL AND club_id='" + club + "'"),
        ('missing receipt', 'DELETE FROM tournament_cancellation_receipts'),
        ('member money', f"UPDATE club_members SET held_chips=1 WHERE club_id='{club}'"),
        ('foreign owner', f"UPDATE auth.users SET email='foreign@example.invalid' WHERE id='{owner}'"),
    ]
    for name, mutation in mutations:
        setup += f"SAVEPOINT refusal; {mutation}; DO $x$ BEGIN IF EXISTS(SELECT 1 FROM terminal_proof WHERE safe_terminal_template) THEN RAISE EXCEPTION '{name} accepted'; END IF; END $x$; ROLLBACK TO refusal;\n"
    setup += f"""
CREATE TEMP TABLE terminal_before AS SELECT t.id,t.ended_at,b.id AS table_id,b.status,b.lifecycle,b.terminal_closed_at,to_jsonb(r) AS receipt
 FROM tournaments t JOIN tables b ON b.tournament_id=t.id JOIN tournament_cancellation_receipts r ON r.tournament_id=t.id
 WHERE t.club_id='{club}';
DO $x$ DECLARE result jsonb; BEGIN
 result:=fn_unwind_unused_first_club_welcome_package('{club}',gen_random_uuid());
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'normal unwind refused: %',result; END IF;
 IF (SELECT safe_terminal_template FROM terminal_proof) IS DISTINCT FROM true THEN RAISE EXCEPTION 'normal unwind changed terminal lineage'; END IF;
 IF EXISTS(SELECT 1 FROM terminal_before old LEFT JOIN tournaments t ON t.id=old.id
 LEFT JOIN tables b ON b.id=old.table_id LEFT JOIN tournament_cancellation_receipts r ON r.tournament_id=t.id
 WHERE t.id IS NULL OR b.id IS NULL OR t.ended_at IS DISTINCT FROM old.ended_at
 OR b.status IS DISTINCT FROM old.status OR b.lifecycle IS DISTINCT FROM old.lifecycle
 OR b.terminal_closed_at IS DISTINCT FROM old.terminal_closed_at OR to_jsonb(r) IS DISTINCT FROM old.receipt)
 THEN RAISE EXCEPTION 'normal unwind rewrote immutable terminal evidence'; END IF;
END $x$;
"""
    setup += "ROLLBACK; SELECT 'terminal admission positive and seven refusal boundaries passed';"
    run('reserved-terminal-welcome-receipt-native', setup, 'terminal admission positive and seven refusal boundaries passed')
