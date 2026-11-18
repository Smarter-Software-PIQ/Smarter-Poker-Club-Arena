-- @install-window: daily-maintenance
BEGIN;
SELECT public.fn_this_file_is_installed_and_never_rehearsed();
COMMIT;
