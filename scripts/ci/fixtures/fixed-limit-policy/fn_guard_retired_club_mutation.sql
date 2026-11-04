CREATE OR REPLACE FUNCTION public.fn_guard_retired_club_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id uuid;
  v_old_club_id uuid;
  v_maintenance boolean :=
    auth.uid() IS NULL
    AND coalesce(current_setting('app.club_retirement_maintenance', true), '') = 'on';
BEGIN
  IF v_maintenance THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'unions' THEN
      v_club_id := OLD.id;
    ELSIF TG_TABLE_NAME = 'table_seats' THEN
      SELECT t.club_id INTO v_club_id FROM public.tables t WHERE t.id = OLD.table_id;
    ELSIF TG_TABLE_NAME IN ('tournament_players', 'tournament_escrow') THEN
      SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = OLD.tournament_id;
    ELSIF TG_TABLE_NAME = 'chip_escrow' THEN
      SELECT cr.club_id INTO v_club_id FROM public.cashout_requests cr WHERE cr.id = OLD.cashout_request_id;
    ELSIF TG_TABLE_NAME = 'credit_invoices' THEN
      SELECT a.club_id INTO v_club_id FROM public.agents a WHERE a.id = OLD.agent_id;
    ELSIF TG_TABLE_NAME = 'tournament_schedule_spawns' THEN
      SELECT s.club_id INTO v_club_id FROM public.tournament_schedules s WHERE s.id = OLD.schedule_id;
    ELSIF TG_TABLE_NAME = 'managed_game_schedules' THEN
      IF OLD.game_kind = 'table' THEN
        SELECT t.club_id INTO v_club_id FROM public.tables t WHERE t.id = OLD.game_id;
      ELSE
        SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = OLD.game_id;
      END IF;
    ELSIF TG_TABLE_NAME IN ('wheel_configs','diamond_game_configs') THEN
      IF OLD.host_kind = 'club' THEN v_club_id := OLD.host_id; END IF;
    ELSIF TG_TABLE_NAME = 'wheel_pools' THEN
      SELECT c.host_id INTO v_club_id FROM public.wheel_configs c
       WHERE c.host_id=OLD.host_id AND c.host_kind='club';
    ELSIF TG_TABLE_NAME = 'diamond_game_pools' THEN
      SELECT c.host_id INTO v_club_id FROM public.diamond_game_configs c
       WHERE c.host_id=OLD.host_id AND c.game=OLD.game AND c.host_kind='club';
    ELSE
      v_club_id := OLD.club_id;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'unions' THEN
      v_club_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'table_seats' THEN
      SELECT t.club_id INTO v_club_id FROM public.tables t WHERE t.id = NEW.table_id;
    ELSIF TG_TABLE_NAME IN ('tournament_players', 'tournament_escrow') THEN
      SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = NEW.tournament_id;
    ELSIF TG_TABLE_NAME = 'chip_escrow' THEN
      SELECT cr.club_id INTO v_club_id FROM public.cashout_requests cr WHERE cr.id = NEW.cashout_request_id;
    ELSIF TG_TABLE_NAME = 'credit_invoices' THEN
      SELECT a.club_id INTO v_club_id FROM public.agents a WHERE a.id = NEW.agent_id;
    ELSIF TG_TABLE_NAME = 'tournament_schedule_spawns' THEN
      SELECT s.club_id INTO v_club_id FROM public.tournament_schedules s WHERE s.id = NEW.schedule_id;
    ELSIF TG_TABLE_NAME = 'managed_game_schedules' THEN
      IF NEW.game_kind = 'table' THEN
        SELECT t.club_id INTO v_club_id FROM public.tables t WHERE t.id = NEW.game_id;
      ELSE
        SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = NEW.game_id;
      END IF;
    ELSIF TG_TABLE_NAME IN ('wheel_configs','diamond_game_configs') THEN
      IF NEW.host_kind = 'club' THEN v_club_id := NEW.host_id; END IF;
    ELSIF TG_TABLE_NAME = 'wheel_pools' THEN
      SELECT c.host_id INTO v_club_id FROM public.wheel_configs c
       WHERE c.host_id=NEW.host_id AND c.host_kind='club';
    ELSIF TG_TABLE_NAME = 'diamond_game_pools' THEN
      SELECT c.host_id INTO v_club_id FROM public.diamond_game_configs c
       WHERE c.host_id=NEW.host_id AND c.game=NEW.game AND c.host_kind='club';
    ELSE
      v_club_id := NEW.club_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF TG_TABLE_NAME = 'unions' THEN
        v_old_club_id := OLD.id;
      ELSIF TG_TABLE_NAME = 'table_seats' THEN
        SELECT t.club_id INTO v_old_club_id FROM public.tables t WHERE t.id = OLD.table_id;
      ELSIF TG_TABLE_NAME IN ('tournament_players', 'tournament_escrow') THEN
        SELECT t.club_id INTO v_old_club_id FROM public.tournaments t WHERE t.id = OLD.tournament_id;
      ELSIF TG_TABLE_NAME = 'chip_escrow' THEN
        SELECT cr.club_id INTO v_old_club_id FROM public.cashout_requests cr WHERE cr.id = OLD.cashout_request_id;
      ELSIF TG_TABLE_NAME = 'credit_invoices' THEN
        SELECT a.club_id INTO v_old_club_id FROM public.agents a WHERE a.id = OLD.agent_id;
      ELSIF TG_TABLE_NAME = 'tournament_schedule_spawns' THEN
        SELECT s.club_id INTO v_old_club_id FROM public.tournament_schedules s WHERE s.id = OLD.schedule_id;
      ELSIF TG_TABLE_NAME = 'managed_game_schedules' THEN
        IF OLD.game_kind = 'table' THEN
          SELECT t.club_id INTO v_old_club_id FROM public.tables t WHERE t.id = OLD.game_id;
        ELSE
          SELECT t.club_id INTO v_old_club_id FROM public.tournaments t WHERE t.id = OLD.game_id;
        END IF;
      ELSIF TG_TABLE_NAME IN ('wheel_configs','diamond_game_configs') THEN
        IF OLD.host_kind = 'club' THEN v_old_club_id := OLD.host_id; END IF;
      ELSIF TG_TABLE_NAME = 'wheel_pools' THEN
        SELECT c.host_id INTO v_old_club_id FROM public.wheel_configs c
         WHERE c.host_id=OLD.host_id AND c.host_kind='club';
      ELSIF TG_TABLE_NAME = 'diamond_game_pools' THEN
        SELECT c.host_id INTO v_old_club_id FROM public.diamond_game_configs c
         WHERE c.host_id=OLD.host_id AND c.game=OLD.game AND c.host_kind='club';
      ELSE
        v_old_club_id := OLD.club_id;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'unions' AND v_club_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:' || v_club_id::text, 0));
  END IF;

  -- Lock both scopes in UUID order.  A writer that began just before retirement
  -- waits here and then observes the committed retired lifecycle.
  PERFORM 1
    FROM public.clubs c
   WHERE c.id IN (v_club_id, v_old_club_id)
   ORDER BY c.id
   FOR KEY SHARE;

  -- These two owning stores have no club FK. Recheck after the shared
  -- parent lock: cleanup may have deleted that parent while this writer waited.
  IF TG_OP <> 'DELETE' AND TG_TABLE_NAME IN ('cash_games','tournament_schedules')
     AND v_club_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.clubs WHERE id=v_club_id) THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND: game records require their owning club'
      USING ERRCODE='23503';
  END IF;

  IF (v_club_id IS NOT NULL OR v_old_club_id IS NOT NULL) AND EXISTS (
    SELECT 1 FROM public.clubs c
     WHERE c.id IN (v_club_id, v_old_club_id) AND c.lifecycle_status = 'retired'
  ) THEN
    RAISE EXCEPTION 'CLUB_RETIRED: gameplay and cashier records are read-only'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$
