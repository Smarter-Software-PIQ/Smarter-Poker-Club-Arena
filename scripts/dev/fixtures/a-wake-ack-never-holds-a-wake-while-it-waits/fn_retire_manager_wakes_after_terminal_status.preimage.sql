CREATE OR REPLACE FUNCTION public.fn_retire_manager_wakes_after_terminal_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF upper(COALESCE(NEW.status,'')) IN ('COMPLETED','CANCELLED','CANCELED')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.tournament_manager_wakes
       SET consumed_at=COALESCE(consumed_at,clock_timestamp())
     WHERE tournament_id=NEW.id AND consumed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$
