-- 20261104193818_player_notes_realtime_for_the_seat_post_it.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The seat post-it (Dan 2026-11-04) marks every opponent the viewer holds a
-- private note on. On the device that wrote the note it updates instantly
-- through the notes service; on the player's OTHER device it only updated on
-- the next table open. This puts player_notes on the realtime publication so
-- a save or delete anywhere reaches every open table of the same player.
--
-- Privacy: postgres_changes applies the table's RLS (owner-only SELECT) to
-- INSERT and UPDATE events on the authenticated socket, and the client
-- additionally filters user_id=eq.<self> and subscribes to those two events
-- only. Supabase does NOT apply RLS to DELETE events, and the only way to
-- filter them is REPLICA IDENTITY FULL, which would broadcast a deleted
-- note's whole row, its text included, to any signed-in subscriber of the
-- table. So the replica identity stays DEFAULT (a DELETE carries the primary
-- key alone, which identifies nothing), and a note deleted on another device
-- leaves the seat on the next table open or socket rejoin rather than live.
-- A note written on another device is live; the private text never leaves
-- its owner's socket.
--
-- player_notes is not a hot table: no engine or cron writes it, so this takes
-- its brief lock during play without the maintenance window.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='player_notes') AND (SELECT relreplident FROM pg_class WHERE oid='public.player_notes'::regclass)='d'
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'player_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_notes;
  END IF;
END $$;

COMMIT;
