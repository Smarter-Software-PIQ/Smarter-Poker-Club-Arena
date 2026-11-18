-- @install-window: daily-maintenance
BEGIN;
ALTER TABLE public.window_rehearsal_seats ADD COLUMN rehearsed int NOT NULL DEFAULT public.fn_window_rehearsal_helper();
COMMIT;
