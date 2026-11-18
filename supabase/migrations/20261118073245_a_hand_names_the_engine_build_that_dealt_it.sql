-- @install-window: daily-maintenance
-- @locks: public.hand_history
-- 20261118073245_a_hand_names_the_engine_build_that_dealt_it.sql
--
-- WHAT THIS ADDS. hand_history.engine_build text NULL: the full 40-character
-- lowercase git commit (GIT_COMMIT_SHA, server/src/releaseIdentity.ts
-- releaseSha) of the engine process that played and committed the hand.
--
-- WHY. hand_history.version is 'v1' on every row, so proving which release
-- dealt a hand (and so whether a fix was serving) means matching ended_at
-- against ca_engine_deploy_attempts. The engine already knows its exact build;
-- it now writes it on the row it already sends.
--
-- HOW IT IS WRITTEN. No new writer, no new round-trip. logHandHistory puts
-- engine_build into p_hand_row of the one accepted-hand transaction
-- (fn_ca_commit_hand_settlement -> fn_ca_insert_hand_with_awards), and only
-- when the process can prove a full SHA; otherwise the key is omitted and the
-- column stays NULL. fn_ca_insert_hand_with_awards (20260906113554) inserts
-- only keys that are real hand_history columns, so the engine and this file
-- may install in either order: before this file the key is ignored, after it
-- the key is stored (the same property kill_pot relies on; pinned by
-- server/src/services/supabase/handHistory.killPotColumn.test.ts).
--
-- WHAT IT DOES NOT DO. Nullable, no default, no constraint, no index, no
-- backfill: ADD COLUMN without a default is catalog-only (no rewrite, no
-- scan), but it takes ACCESS EXCLUSIVE on hand_history, hence the daily
-- window. No CHECK on purpose: a malformed value must never refuse a hand's
-- settlement; the engine only sends a value its own regex proved.
-- hand_history is in no publication (pg_publication_tables, read 2026-11-18),
-- so realtime decoding is untouched; WAL grows by one ~41-byte text per row.
-- Movement proofs (smarter_private.f06_assert_movement, 20260926043127) drop
-- a key absent from a proof only while its live value is null; every row
-- written before install is null here and a row is never updated after
-- insert, so no stored proof changes meaning.
--
-- @live-proof: (SELECT count(*) = 1 FROM pg_attribute a WHERE a.attrelid = 'public.hand_history'::regclass AND a.attname = 'engine_build' AND NOT a.attisdropped AND NOT a.attnotnull AND NOT a.atthasdef AND a.atttypid = 'text'::regtype)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
ALTER TABLE public.hand_history ADD COLUMN engine_build text;
COMMENT ON COLUMN public.hand_history.engine_build IS
  'Full git commit of the engine build that committed this hand (GIT_COMMIT_SHA). NULL before 20261118073245 or when the process could not prove a full SHA.';
COMMIT;
