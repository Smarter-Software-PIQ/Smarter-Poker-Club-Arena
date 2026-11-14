-- 20261114002055_per_horse_upgrade_evidence_daily.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- WHICH HORSE EXERCISED WHICH UPGRADE IS ON THE RECORD
-- ============================================================================
--
-- THE BLIND SPOT. horse_brain_telemetry is (day, feature, fires): a fleet
-- total with no Horse identity. "Every one of the 1,000 Horses exercised
-- upgrade 02 today" cannot be answered from it, and horse_brain_activity_rollup
-- (20261110054654) records that a Horse decided, not what its decisions used.
--
-- WHAT THIS ADDS. New objects only:
--
--   1. public.horse_upgrade_evidence_daily: per (day UTC, Horse, game variant,
--      lane, upgrade id), `decisions` (decisions that Horse made in that
--      variant and lane that day, the opportunity baseline) and `invoked` (the
--      decisions among them in which one of the upgrade's evidence counters
--      fired). Written additively by the engine's decision workers and its
--      main process every 300 seconds
--      (server/src/services/HorseUpgradeEvidenceFlush.ts).
--
--   2. public.horse_upgrade_evidence_batches: one receipt per accepted batch
--      (id and payload digest), so a batch whose acknowledgement was lost and
--      is sent again is answered 'replayed' and never added twice.
--
--   3. public.fn_horse_upgrade_evidence_flush(p_payload text): the only
--      writer. Modelled on fn_horse_brain_flush_receipt (20260914130422):
--      strict header and row validation, bounded size, receipt first, then
--      the additive upsert in key order.
--
-- LOCKS. No existing relation is read, written, altered or referenced: no
-- foreign key to profiles (CLAUDE.md DDL rule 7), no trigger, no change to any
-- existing function. The transaction takes locks only on the two tables it
-- creates, so it is an ordinary install-on-merge migration, not a
-- daily-maintenance one.
--
-- RETENTION. Both tables are bounded inside the writer, the way
-- horse_brain_flush_receipts is: no schedule.
--
--   Receipts: a batch collected more than 32 days ago is refused before
--   anything is written, a batch stamped more than a day ahead of the database
--   clock is refused, and each accepted batch deletes up to 64 receipts
--   accepted more than 40 days ago. A pruned receipt therefore belongs to a
--   batch that would be refused as expired, so pruning can never make a resend
--   additive again.
--
--   Daily rows: kept 90 days. Each accepted batch deletes up to 512 rows whose
--   day is more than 90 days before that batch's day, oldest first, skipping
--   rows another writer holds. The primary key begins with day, so the delete
--   is a range scan of that index; no extra index. A batch's day is at most 39
--   days behind the clock (32-day expiry plus the 7-day window), so a row is
--   never pruned before it is 90 days old.
--
-- SIZE. Production's horse_brain_activity_rollup implies about 39,000 rows a
-- day here (Horse x variant x lane x declared upgrade), so about 3.5 million
-- rows at 90 days. At some 1,000 accepted batches a day the 512-row prune has
-- more than ten times the capacity the daily inflow needs.
--
-- WRITE CHURN. Every active cell's row is rewritten by every flush (an
-- additive update; about 223 bytes of WAL each, measured). The engine flushes
-- every 300 seconds, not 60: a cell is then rewritten at most 288 times a day
-- instead of 1,440, where 60 seconds measured on the order of 1 to 2 GB of WAL
-- a day. The daily table is created with fillfactor 85 so those
-- updates find room on their own page and stay HOT: no column they change
-- (decisions, invoked, updated_at) is indexed, so a HOT update writes no index
-- entry and its dead version is reclaimed by page pruning, without vacuum.
--
-- TIMEOUTS, STATED EXACTLY. `SET lock_timeout = '2s'` on the function works: a
-- lock wait inside it is cut at 2 seconds. `SET statement_timeout = '5s'` on
-- the function does NOT bound the call: the statement timer is armed when the
-- caller's top-level statement starts, before this setting applies (probed on
-- PostgreSQL 17: a function with SET statement_timeout = '1s' around
-- pg_sleep(3) ran 3 seconds). The effective server-side bound is the calling
-- role's own statement timeout. The clause is kept because it is not wrong,
-- only inert here, and it matches fn_horse_brain_flush_receipt; nothing relies
-- on it. A write can therefore commit after the engine's 5-second client
-- abort. The design absorbs that: the engine resends the same bytes under the
-- same batch id and the receipt answers 'replayed'.
--
-- PRIVILEGES. RLS on with no policy; every privilege revoked from PUBLIC, anon
-- and authenticated; the tables are written only inside the SECURITY DEFINER
-- function, whose EXECUTE is service_role's alone. service_role may read the
-- daily table (the operations read in scripts/ops). GRANT and REVOKE do not
-- reload the PostgREST schema cache.

BEGIN;

CREATE TABLE public.horse_upgrade_evidence_daily (
  day date NOT NULL,
  horse_user_id uuid NOT NULL,
  game_variant text NOT NULL CHECK (game_variant ~ '^[a-z0-9_]{1,32}$'),
  lane text NOT NULL CHECK (lane IN ('cash', 'tournament')),
  upgrade_id text NOT NULL CHECK (upgrade_id ~ '^[a-z0-9_]{1,64}$'),
  decisions bigint NOT NULL CHECK (decisions >= 0),
  invoked bigint NOT NULL CHECK (invoked >= 0),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (day, horse_user_id, game_variant, lane, upgrade_id),
  CONSTRAINT horse_upgrade_evidence_daily_invoked_within_decisions CHECK (invoked <= decisions)
) WITH (fillfactor = 85);

CREATE TABLE public.horse_upgrade_evidence_batches (
  batch_id uuid PRIMARY KEY,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX horse_upgrade_evidence_batches_expiry
  ON public.horse_upgrade_evidence_batches (accepted_at, batch_id);

ALTER TABLE public.horse_upgrade_evidence_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horse_upgrade_evidence_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.horse_upgrade_evidence_daily FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.horse_upgrade_evidence_batches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.horse_upgrade_evidence_daily TO service_role;

CREATE FUNCTION public.fn_horse_upgrade_evidence_flush(p_payload text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '2s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  v jsonb; r jsonb;
  v_id uuid; v_day date; v_collected timestamptz;
  v_digest text; v_existing text; v_inserted integer;
  v_decisions numeric; v_invoked numeric;
BEGIN
  IF p_payload IS NULL OR octet_length(p_payload) > 524288 THEN
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD';
  END IF;
  BEGIN
    v := p_payload::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD';
  END;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object'
     OR v->'version' IS DISTINCT FROM '1'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(v)) <> 8
     OR NOT (v ?& ARRAY['version','batchId','workerId','sequence','sourceRelease','day','collectedAt','rows'])
     OR jsonb_typeof(v->'batchId') IS DISTINCT FROM 'string'
     OR (v->>'batchId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(v->'workerId') IS DISTINCT FROM 'string'
     OR (v->>'workerId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(v->'sequence') IS DISTINCT FROM 'number'
     OR (v->>'sequence')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR trunc((v->>'sequence')::numeric) <> (v->>'sequence')::numeric
     OR (v->'sourceRelease' <> 'null'::jsonb AND
         (jsonb_typeof(v->'sourceRelease') <> 'string' OR (v->>'sourceRelease') !~ '^[0-9a-f]{40}$'))
     OR jsonb_typeof(v->'day') IS DISTINCT FROM 'string'
     OR (v->>'day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR jsonb_typeof(v->'collectedAt') IS DISTINCT FROM 'string'
     OR (v->>'collectedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     OR jsonb_typeof(v->'rows') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER';
  END IF;
  BEGIN
    v_id := (v->>'batchId')::uuid;
    v_day := (v->>'day')::date;
    v_collected := (v->>'collectedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    -- a well-shaped string that is not a date (month 13) is a header fault, not a transport one
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER';
  END;
  IF v_collected < transaction_timestamp() - interval '32 days' THEN
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_EXPIRED';
  END IF;
  -- The day is the day the cells were counted; a batch may carry the day before
  -- its collection (a drain just after midnight, or rows held while the
  -- function was not installed), never a later one and never an old one.
  IF v_collected > transaction_timestamp() + interval '1 day'
     OR v_day > (v_collected AT TIME ZONE 'UTC')::date
     OR v_day < (v_collected AT TIME ZONE 'UTC')::date - 7
     OR jsonb_array_length(v->'rows') NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(v->'rows') LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(r)) <> 6
       OR NOT (r ?& ARRAY['horseUserId','gameVariant','lane','upgradeId','decisions','invoked'])
       OR jsonb_typeof(r->'horseUserId') IS DISTINCT FROM 'string'
       OR (r->>'horseUserId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(r->'gameVariant') IS DISTINCT FROM 'string'
       OR (r->>'gameVariant') !~ '^[a-z0-9_]{1,32}$'
       OR jsonb_typeof(r->'lane') IS DISTINCT FROM 'string'
       OR (r->>'lane') NOT IN ('cash', 'tournament')
       OR jsonb_typeof(r->'upgradeId') IS DISTINCT FROM 'string'
       OR (r->>'upgradeId') !~ '^[a-z0-9_]{1,64}$'
       OR jsonb_typeof(r->'decisions') IS DISTINCT FROM 'number'
       OR jsonb_typeof(r->'invoked') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_ROW';
    END IF;
    v_decisions := (r->>'decisions')::numeric; v_invoked := (r->>'invoked')::numeric;
    IF v_decisions NOT BETWEEN 0 AND 9007199254740991 OR trunc(v_decisions) <> v_decisions
       OR v_invoked NOT BETWEEN 0 AND 9007199254740991 OR trunc(v_invoked) <> v_invoked
       OR v_invoked > v_decisions THEN
      RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_INVALID_ROW';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'horseUserId', value->>'gameVariant', value->>'lane', value->>'upgradeId'))
        FROM jsonb_array_elements(v->'rows')) <> jsonb_array_length(v->'rows') THEN
    RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_DUPLICATE_ROW';
  END IF;
  v_digest := encode(sha256(convert_to(p_payload, 'UTF8')), 'hex');
  INSERT INTO public.horse_upgrade_evidence_batches (batch_id, payload_sha256)
  VALUES (v_id, v_digest)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT payload_sha256 INTO v_existing FROM public.horse_upgrade_evidence_batches WHERE batch_id = v_id;
    IF v_existing IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'HORSE_UPGRADE_EVIDENCE_BATCH_COLLISION';
    END IF;
    RETURN jsonb_build_object('version',1,'status','replayed','batchId',v_id,'payloadSha256',v_digest);
  END IF;
  -- Key order, so two workers writing the same Horse cannot deadlock.
  INSERT INTO public.horse_upgrade_evidence_daily AS h
    (day, horse_user_id, game_variant, lane, upgrade_id, decisions, invoked)
    SELECT v_day, (value->>'horseUserId')::uuid, value->>'gameVariant', value->>'lane', value->>'upgradeId',
           (value->>'decisions')::bigint, (value->>'invoked')::bigint
    FROM jsonb_array_elements(v->'rows')
    ORDER BY (value->>'horseUserId')::uuid, value->>'gameVariant', value->>'lane', value->>'upgradeId'
    ON CONFLICT (day, horse_user_id, game_variant, lane, upgrade_id) DO UPDATE SET
      decisions = h.decisions + EXCLUDED.decisions,
      invoked = h.invoked + EXCLUDED.invoked,
      updated_at = transaction_timestamp();
  -- Retention, bounded here, no schedule: daily rows more than 90 days before this batch's day,
  -- oldest first, at most 512 per accepted batch, skipping rows another writer holds.
  DELETE FROM public.horse_upgrade_evidence_daily AS d
  USING (
    SELECT day, horse_user_id, game_variant, lane, upgrade_id
      FROM public.horse_upgrade_evidence_daily
     WHERE day < v_day - 90
     ORDER BY day, horse_user_id, game_variant, lane, upgrade_id
     LIMIT 512 FOR UPDATE SKIP LOCKED
  ) AS old
  WHERE d.day = old.day AND d.horse_user_id = old.horse_user_id AND d.game_variant = old.game_variant
    AND d.lane = old.lane AND d.upgrade_id = old.upgrade_id;
  -- Bounded here, no schedule: a pruned receipt's batch is refused above as expired.
  WITH expired AS (
    SELECT batch_id FROM public.horse_upgrade_evidence_batches
    WHERE accepted_at < transaction_timestamp() - interval '40 days'
    ORDER BY accepted_at, batch_id LIMIT 64 FOR UPDATE SKIP LOCKED
  ) DELETE FROM public.horse_upgrade_evidence_batches WHERE batch_id IN (SELECT batch_id FROM expired);
  RETURN jsonb_build_object('version',1,'status','recorded','batchId',v_id,'payloadSha256',v_digest);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_horse_upgrade_evidence_flush(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_upgrade_evidence_flush(text) TO service_role;

COMMENT ON TABLE public.horse_upgrade_evidence_daily IS
  'Per UTC day, Horse, variant, lane and upgrade: decisions (opportunity baseline) and invoked (decisions in which an evidence counter of that upgrade fired). Additive, written only by fn_horse_upgrade_evidence_flush. Complete only for batches the engine wrote: a process that dies loses up to one 300-second flush interval. Kept 90 days, pruned inside the writer.';
COMMENT ON TABLE public.horse_upgrade_evidence_batches IS
  'Receipts of accepted per-Horse upgrade evidence batches (id and payload digest) for replay de-duplication. Pruned inside the writer after 40 days; batches older than 32 days are refused.';

COMMIT;
