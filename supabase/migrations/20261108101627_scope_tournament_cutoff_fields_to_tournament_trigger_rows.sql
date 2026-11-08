-- A shared trigger must branch on the relation before PostgreSQL plans a
-- statement that references tournament-only fields of OLD and NEW.
BEGIN;
DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure);
  before_clause constant text := $before$  IF TG_TABLE_NAME='tournaments'
     AND session_user='postgres' AND current_user='postgres'
     AND coalesce(current_setting('role',true),'none') IN ('none','postgres')
     AND auth.role() IS NULL
     AND current_setting('application_name')='apply-recorded-migration'
     AND OLD.late_reg_levels=12 AND NEW.late_reg_levels=10
     AND to_jsonb(NEW)=to_jsonb(public.fn_ca_ten_level_late_registration(OLD)) THEN
    RETURN NEW;
  END IF;$before$;
  after_clause constant text := $after$  IF TG_TABLE_NAME='tournaments' THEN
    IF session_user='postgres' AND current_user='postgres'
       AND coalesce(current_setting('role',true),'none') IN ('none','postgres')
       AND auth.role() IS NULL
       AND current_setting('application_name')='apply-recorded-migration'
       AND OLD.late_reg_levels=12 AND NEW.late_reg_levels=10
       AND to_jsonb(NEW)=to_jsonb(public.fn_ca_ten_level_late_registration(OLD)) THEN
      RETURN NEW;
    END IF;
  END IF;$after$;
BEGIN
  IF md5(definition) <> '02f9545204dcfe787dc03191a750a6fb'
     OR strpos(definition,before_clause)=0 THEN
    RAISE EXCEPTION 'Managed lifecycle trigger has an unexpected predecessor';
  END IF;
  EXECUTE replace(definition,before_clause,after_clause);
END
$patch$;
COMMIT;
