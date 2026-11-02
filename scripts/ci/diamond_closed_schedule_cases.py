"""Closed-arena schedule transaction cases for the existing native closure suite."""
from pathlib import Path


def qualify(e, root, db):
    paths = list((root / 'supabase/migrations').glob('*_diamond_closure_disables_and_rejects_future_schedules.sql'))
    if len(paths) != 1:
        raise RuntimeError('exact closed-arena schedule migration required')
    migration = paths[0]
    e.sql(db, """
CREATE TABLE public.tournament_schedules(id uuid PRIMARY KEY,club_id uuid,active boolean,updated_at timestamptz DEFAULT now());
INSERT INTO public.tournament_schedules VALUES
('90000000-0000-0000-0000-000000000001','002c2d27-9584-4e52-835a-bb2be148fc81',true,now()),
('90000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',true,now());
""", label='closed-arena-active-schedule-defect')
    e.sql(db, migration.read_text(), label='closed-arena-schedule-install')
    e.sql(db, """
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tournament_schedules WHERE club_id='002c2d27-9584-4e52-835a-bb2be148fc81' AND active) THEN RAISE EXCEPTION 'existing schedule remained active'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tournament_schedules WHERE id='90000000-0000-0000-0000-000000000002' AND active) THEN RAISE EXCEPTION 'other club changed'; END IF;
 BEGIN
  UPDATE tournament_schedules SET active=true WHERE id='90000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'reactivation admitted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM <> 'diamond_arena_closed' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO tournament_schedules VALUES(gen_random_uuid(),'002c2d27-9584-4e52-835a-bb2be148fc81',true,now());
  RAISE EXCEPTION 'new active schedule admitted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM <> 'diamond_arena_closed' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE tournament_schedules SET club_id='002c2d27-9584-4e52-835a-bb2be148fc81' WHERE id='90000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'active scope move admitted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM <> 'diamond_arena_closed' THEN RAISE; END IF;
 END;
 INSERT INTO tournament_schedules VALUES(gen_random_uuid(),'002c2d27-9584-4e52-835a-bb2be148fc81',false,now());
 UPDATE tournament_schedules SET updated_at=now() WHERE NOT active;
 IF has_function_privilege('anon','public.fn_ca_closed_diamond_schedule_guard()','EXECUTE') OR has_function_privilege('authenticated','public.fn_ca_closed_diamond_schedule_guard()','EXECUTE') THEN RAISE EXCEPTION 'trigger function publicly executable'; END IF;
END $$;
""", label='closed-arena-schedule-boundaries')
    return migration
