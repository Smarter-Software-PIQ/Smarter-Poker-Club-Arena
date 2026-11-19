"""Current original attendance, operator and hand sources for the disposable funded fixture."""
import json
from pathlib import Path

CAPTURE = 'scripts/ci/fixtures/mtt-format-activation/current-attendance-and-continuation.json'
CONTINUATION = '20261028233353_durable_private_hand_continuation.sql'
SUBMISSION = '20260918092329_retained_hand_submission_atomic_acknowledgement.sql'


def install_sources(e, case):
    def segment(version, start, end):
        source, = (e.root/'supabase/migrations').glob(version+'*')
        raw = source.read_text()
        return raw[raw.index(start):raw.index(end, raw.index(start))]

    current = json.loads((e.root/CAPTURE).read_text())
    ddl = [
        segment('20261103193545','CREATE TABLE IF NOT EXISTS smarter_private.daily_window_policy','CREATE OR REPLACE FUNCTION public.fn_daily_window_policy'),
        segment('20261103222817','CREATE OR REPLACE FUNCTION public.fn_daily_window_seat_first_kind','DO $'),
        segment('20261103222817','CREATE OR REPLACE FUNCTION public.fn_daily_window_entry_refusal','DO $'),
        segment('20261010035502','CREATE TABLE public.ca_operator_floor_hold (','CREATE TABLE public.ca_operator_table_closes'),
        segment('20261012181905','CREATE TABLE public.ca_launch_operator_scopes(',';')+';',
        segment('20261030001305','CREATE TABLE public.ca_tournament_start_hold (','INSERT INTO public.ca_tournament_start_hold'),
        segment('20261030001305','CREATE FUNCTION public.fn_ca_new_tournament_starts_blocked','CREATE OR REPLACE FUNCTION public.fn_ca_launch_tournament_start_refused'),
        segment('20261015132042','INSERT INTO public.ca_money_rpc_registry (proname,status,notes)','-- ---'),
        segment('20261015132042','CREATE TABLE public.tournament_ticket_entry_targets','COMMENT ON TABLE public.tournament_ticket_entry_targets'),
        segment('20260924043217','CREATE TABLE public.tournament_stage_plans','CREATE TABLE public.tournament_stage_transitions'),
        segment('20260924043217','CREATE TABLE public.tournament_stage_resume_receipts','-- ---'),
        segment('20260918053310','ALTER TABLE smarter_private.f06_operations ADD COLUMN abort_receipt_id',';')+';',
        segment('20260918095135','CREATE TABLE smarter_private.f06_movement_admissions','CREATE FUNCTION smarter_private.f06_movement_immutable'),
        segment(CONTINUATION,'CREATE TABLE smarter_private.hand_continuations','CREATE TRIGGER hand_continuation_disposition_immutable'),
        segment(SUBMISSION,'CREATE TABLE smarter_private.hand_submission_dispositions','ALTER TABLE smarter_private.hand_submissions OWNER'),
    ]
    # Keep real clock policy active. Select a real test time zone in its open
    # interval so the paid concurrency test is independent of CI wall time.
    ddl += ["""UPDATE smarter_private.daily_window_policy SET time_zone=CASE
      WHEN (clock_timestamp() AT TIME ZONE 'UTC')::time BETWEEN '03:00' AND '07:00'
      THEN 'Pacific/Honolulu' ELSE 'UTC' END WHERE singleton;
      INSERT INTO public.ca_tournament_start_hold(singleton,operation_id,blocked,reason)
      VALUES(true,'86000000-0000-0000-0000-000000000011',false,'Disposable funded event opening');"""]
    for row in current:
        ddl.append(row['def']+';')
        ddl.append('REVOKE ALL ON FUNCTION '+row['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
        for role in row['execute']:
            ddl.append('GRANT EXECUTE ON FUNCTION '+row['signature']+' TO '+role+';')
    ddl += ["DO $$ BEGIN IF md5(pg_get_functiondef('"+row['signature']+"'::regprocedure)) <> '"+
            row['md5']+"' THEN RAISE EXCEPTION 'Current original changed'; END IF; END $$;" for row in current]
    e.sql(case,'BEGIN; SET LOCAL check_function_bodies=false;\n'+'\n'.join(ddl)+'\nCOMMIT;',label='current-original-operator-attendance-and-continuation')


def open_sibling(e, case, tournament, club):
    source = (e.root/'scripts/ci/probes/hand-continuation-native.sql').read_text()
    retain = source[source.index('CREATE FUNCTION pg_temp.continuation_payload'):source.index('CREATE FUNCTION pg_temp.continuation_assert')]
    retain = retain.replace('pg_temp.', 'r46_activation.').replace('86000000-0000-0000-0000-000000000001',tournament)
    e.sql(case,f"""BEGIN; SET LOCAL session_replication_role=replica;
      UPDATE public.tournaments SET status='RUNNING',start_time=clock_timestamp()-interval '5 minutes',
         started_at=clock_timestamp()-interval '5 minutes',current_level=1,late_reg_levels=5,prize_pool_finalized=false
       WHERE id='{tournament}';
      INSERT INTO public.tables(id,name,tournament_id,status,lifecycle,current_players,game_type,club_id,max_players,seat_game_scope,seat_admission_key)
      VALUES('86100000-0000-0000-0000-000000000001','Funded event sibling','{tournament}','running','live',2,'tournament','{club}',2,
        'table:86100000-0000-0000-0000-000000000001','tournament:{tournament}'),
       ('86100000-0000-0000-0000-000000000002','Open chairs','{tournament}','running','live',0,'tournament','{club}',9,
        'table:86100000-0000-0000-0000-000000000002','tournament:{tournament}');
      INSERT INTO public.table_seats(table_id,seat_number,user_id,stack,status,joined_at,leave_pending,is_sitting_out,is_away,club_id,active_game_scope,active_parent_key)
      SELECT '86100000-0000-0000-0000-000000000001',row_number() OVER (ORDER BY user_id),user_id,10,
       'active',clock_timestamp(),false,false,false,'{club}','table:86100000-0000-0000-0000-000000000001','tournament:{tournament}' FROM (SELECT user_id FROM public.tournament_players
       WHERE tournament_id='{tournament}' AND status IN ('registered','playing') ORDER BY user_id LIMIT 2) u;
      INSERT INTO public.engine_tournament_leases(tournament_id,instance_id,engine_version,acquired_at,heartbeat_at,lease_generation,protocol_version)
       VALUES('{tournament}','native-attendance','native',clock_timestamp(),clock_timestamp(),'86500000-0000-0000-0000-000000000001',2);
      INSERT INTO smarter_private.f06_hand_permits(permit_id,tournament_id,table_id,lifecycle,hand_number,custody_id,generation,state)
      SELECT '86600000-0000-0000-0000-000000000001',tournament_id,id,f06_lifecycle,8600001,
      '86700000-0000-0000-0000-000000000001','86500000-0000-0000-0000-000000000001','reserved'
       FROM public.tables WHERE id='86100000-0000-0000-0000-000000000001';
      SET LOCAL session_replication_role=origin; {retain} COMMIT;""",label='original-sibling-hand-opening')


def request_continuation(tournament, sequence):
    return f"""BEGIN; SET LOCAL lock_timeout='300ms'; SET LOCAL request.jwt.claim.role='service_role';
      SET LOCAL request.jwt.claims='{{"role":"service_role"}}'; SET LOCAL app.smarter_data_actor='tournament-manager';
      SET LOCAL app.smarter_tournament_id='{tournament}'; SET LOCAL app.smarter_tournament_lease_generation='86500000-0000-0000-0000-000000000001';
      SELECT r46_activation.retain_continuation({sequence}); COMMIT;"""
