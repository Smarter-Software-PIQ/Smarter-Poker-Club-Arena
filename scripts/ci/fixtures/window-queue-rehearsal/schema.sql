-- The "production" the native regression restores: one table, one function.
CREATE TABLE public.window_rehearsal_seats (id int PRIMARY KEY, stack numeric NOT NULL DEFAULT 0);
CREATE FUNCTION public.fn_window_rehearsal_live() RETURNS int LANGUAGE sql AS 'SELECT 1';
