-- 20261110051146_the_public_tournament_views_read_with_their_owners_rights.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. trg_new_view_respects_the_caller sets security_invoker = true on every
-- new public view that does not say otherwise, which is the right default.
-- tournament_players_public and ca_closed_player_labels (20261109235153) did
-- not say otherwise, so they were made caller-rights views, and a
-- caller-rights view cannot do the one thing these two exist for:
--   * a reader needs profiles.status and profiles.is_horse to know who is a
--     closed person; anon reads neither and authenticated does not read
--     is_horse, so a read of username through the view was refused
--     ("permission denied for table profiles"), measured in production as
--     anon before any client asked the view;
--   * once tournament_players hides a closed person's rows from ordinary
--     readers, a caller-rights view would hide them too, and results would
--     lose the placement instead of showing its label.
-- Masking a column for readers who may not see the unmasked value is the
-- case owner rights exist for.
--
-- WHAT. Both views say security_invoker = false, the explicit declaration
-- the trigger leaves alone. What they expose is unchanged and is no more
-- than their readers already hold: every tournament_players column the table
-- already grants to anon and authenticated, with username withheld for a
-- closed person; and, for a closed non-horse profile, its id and the label
-- its scrubbed profile carries. Both stay read-only for every client role.
--
-- No row is written, moved or rewritten. Not a repair job.
-- @live-proof: (SELECT bool_and(COALESCE(array_to_string(c.reloptions, ','), '') LIKE '%security_invoker=false%') AND count(*) = 2 FROM pg_class c WHERE c.oid IN ('public.tournament_players_public'::regclass, 'public.ca_closed_player_labels'::regclass)) AND NOT has_table_privilege('anon', 'public.tournament_players_public', 'INSERT, UPDATE, DELETE') AND NOT has_table_privilege('authenticated', 'public.tournament_players_public', 'INSERT, UPDATE, DELETE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

ALTER VIEW public.ca_closed_player_labels SET (security_invoker = false);
ALTER VIEW public.tournament_players_public SET (security_invoker = false);

COMMIT;
