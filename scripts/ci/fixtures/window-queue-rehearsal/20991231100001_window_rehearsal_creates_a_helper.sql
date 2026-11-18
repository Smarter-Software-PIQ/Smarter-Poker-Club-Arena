-- @install-window: daily-maintenance
BEGIN;
CREATE FUNCTION public.fn_window_rehearsal_helper() RETURNS int LANGUAGE sql AS 'SELECT public.fn_window_rehearsal_live()';
COMMIT;
