CREATE OR REPLACE FUNCTION public.fn_note_human_seat_seen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := COALESCE(NEW.user_id, OLD.user_id);
  tid uuid := COALESCE(NEW.table_id, OLD.table_id);
BEGIN
  IF uid IS NOT NULL AND tid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = uid AND COALESCE(p.is_horse, false) = false
  ) THEN
    UPDATE public.tables SET last_human_seen_at = now() WHERE id = tid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
