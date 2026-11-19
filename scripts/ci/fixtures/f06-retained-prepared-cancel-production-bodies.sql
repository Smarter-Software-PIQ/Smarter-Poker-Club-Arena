-- Production's exact bodies (pg_get_functiondef, kuklfnapbkmacvwxktbh,
-- 2026-11-19), read only. scripts/ci/test-f06-retained-prepared-cancel-postgres.py
-- installs them and asserts each md5 before applying migration
-- 20261119053155 byte for byte.
CREATE OR REPLACE FUNCTION public.fn_ca_f06_share_table_lane(p_tournament_id uuid, p_lease_generation uuid, p_table_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
BEGIN
  /* THE SHARED TABLE LANE OF A TOURNAMENT (2026-10-03). For per-table F06
     hand calls only: what f06_prefix does for one table and no users, with
     the tournament lane T(id) taken SHARED instead of exclusive and no lock
     on the tournament row (its status is written only under T(id) or G
     exclusive). Same order as f06_prefix and as
     fn_ca_share_settlement_lane_for_table: lease fence, G shared, T(id)
     shared, lease re-check, table row, seats. */
  IF p_table_id IS NULL THEN
    RAISE EXCEPTION 'F06_TABLE_LANE_NEEDS_A_TABLE' USING ERRCODE = '22023';
  END IF;
  PERFORM smarter_private.f06_authority(p_tournament_id, p_lease_generation);
  /* 20261118160405: B shared, never G: one event's authority queued on
     the platform key never pauses another event's table. */
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:hand-settlement-barrier:v1', 0));
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0));
  PERFORM smarter_private.f06_authority(p_tournament_id, p_lease_generation, false);
  PERFORM 1 FROM public.tables WHERE id = p_table_id FOR UPDATE;
  PERFORM s.id FROM public.table_seats s JOIN public.tables tb ON tb.id = s.table_id
   WHERE tb.tournament_id = p_tournament_id AND s.table_id = p_table_id
   ORDER BY s.id FOR UPDATE OF s;
END
$function$
;
CREATE OR REPLACE FUNCTION smarter_private.lock_hand_continuation_maintenance_lane()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
 SET lock_timeout TO '1s'
AS $function$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(530090,1);
END $function$
;
CREATE OR REPLACE FUNCTION smarter_private.assert_hand_continuation_disposition(tab uuid, hn bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d text;
BEGIN
  INSERT INTO smarter_private.hand_continuation_dispositions(table_id, hand_number, disposition)
    VALUES(tab, hn, 'disposed') ON CONFLICT(table_id, hand_number) DO NOTHING;
  SELECT disposition INTO STRICT d FROM smarter_private.hand_continuation_dispositions
   WHERE table_id = tab AND hand_number = hn;
  IF d <> 'disposed' THEN RAISE EXCEPTION 'HAND_CONTINUATION_UNSETTLED' USING ERRCODE = '55000'; END IF;
END $function$
;
CREATE OR REPLACE FUNCTION smarter_private.f06_retained_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d smarter_private.hand_submission_dispositions;
BEGIN
 IF NEW.state = 'accepted' AND EXISTS (SELECT 1 FROM smarter_private.hand_continuations c WHERE c.permit_id = NEW.permit_id) THEN
  IF NOT EXISTS (SELECT 1 FROM public.hand_atomic_commits a WHERE a.table_id = NEW.table_id
    AND a.hand_number = NEW.hand_number AND a.hand_id = NEW.evidence_id AND a.post_commit_completed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'HAND_CONTINUATION_ACCEPTANCE_UNPROVEN' USING ERRCODE='55000';
  END IF;
  -- Positive atomic acceptance owns cleanup; no periodic private-deck retention.
  DELETE FROM smarter_private.hand_continuations WHERE permit_id = NEW.permit_id;
 END IF;
 IF NEW.state='aborted_unsettled' AND EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions a
 WHERE a.receipt_id=NEW.evidence_id AND a.permit_id=NEW.permit_id AND a.table_id=NEW.table_id AND a.hand_number=NEW.hand_number
 AND a.original->'permit'=to_jsonb(OLD) AND a.boundary->>'closure_mode'='equal_share') THEN RETURN NEW;END IF;
 IF NEW.state NOT IN ('never_started','aborted_unsettled') THEN RETURN NEW; END IF;
 PERFORM smarter_private.assert_hand_continuation_disposition(NEW.table_id, NEW.hand_number);
 INSERT INTO smarter_private.hand_submission_dispositions(table_id,hand_number,permit_id,disposition,submission_id)
 VALUES(NEW.table_id,NEW.hand_number,NEW.permit_id,'disposed',NULL) ON CONFLICT(table_id,hand_number) DO NOTHING;
 SELECT * INTO STRICT d FROM smarter_private.hand_submission_dispositions WHERE table_id=NEW.table_id AND hand_number=NEW.hand_number;
 IF d.disposition<>'disposed' OR (d.permit_id IS NOT NULL AND d.permit_id IS DISTINCT FROM NEW.permit_id) THEN
  RAISE EXCEPTION 'F06_RETAINED_HAND_SUBMISSION_REQUIRES_ACCEPTED_DISPOSITION' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_f06_cancel_prepared_hand(p_tournament_id uuid, p_lease_generation uuid, p_table_id uuid, p_lifecycle bigint, p_permit_id uuid, p_hand_number bigint, p_custody_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE h smarter_private.f06_hand_permits; r smarter_private.f06_prepared_hand_cancellations;
BEGIN
 IF p_tournament_id IS NULL OR p_lease_generation IS NULL OR p_table_id IS NULL
 OR p_lifecycle IS NULL OR p_permit_id IS NULL OR p_hand_number IS NULL
 OR p_hand_number<1 OR p_custody_id IS NULL THEN
 RAISE EXCEPTION 'F06_PREPARED_IDENTITY_REQUIRED' USING ERRCODE='22023'; END IF;
 -- Unchanged protocol-2 admission and canonical lease/lane/physical-row order.
 -- A successor lease cannot certify the original process's local non-actuation.
 PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,'{}',ARRAY[p_table_id]);
 SELECT * INTO h FROM smarter_private.f06_hand_permits WHERE permit_id=p_permit_id FOR UPDATE;
 IF NOT FOUND OR (h.tournament_id,h.generation,h.table_id,h.lifecycle,h.hand_number,h.custody_id)
 IS DISTINCT FROM(p_tournament_id,p_lease_generation,p_table_id,p_lifecycle,p_hand_number,p_custody_id) THEN
 RAISE EXCEPTION 'F06_PREPARED_ORIGINAL_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM smarter_private.f06_prepared_hand_cancellations WHERE permit_id=p_permit_id;
 IF FOUND THEN
 IF (r.tournament_id,r.generation,r.table_id,r.lifecycle,r.hand_number,r.custody_id)
 IS DISTINCT FROM(p_tournament_id,p_lease_generation,p_table_id,p_lifecycle,p_hand_number,p_custody_id)
 OR h.state<>'never_started' OR h.evidence_id IS DISTINCT FROM p_permit_id THEN
 RAISE EXCEPTION 'F06_PREPARED_RECEIPT_CHANGED' USING ERRCODE='55000'; END IF;
 ELSE
 IF h.state<>'reserved' OR h.evidence_id IS NOT NULL THEN
 RAISE EXCEPTION 'F06_PREPARED_NOT_RESERVED' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tables tb JOIN public.tournaments t ON t.id=tb.tournament_id
 WHERE tb.id=p_table_id AND tb.tournament_id=p_tournament_id AND tb.f06_lifecycle=p_lifecycle
 AND upper(t.status)='RUNNING' AND lower(tb.status)<>'closed' AND NOT COALESCE(tb.is_deleted,false)) THEN
 RAISE EXCEPTION 'F06_HAND_LIFECYCLE' USING ERRCODE='55000'; END IF;
 -- Durable witnesses only REFUSE a claimed no-start; their absence cannot grant it.
 -- The active snapshot uses its maintained partial index. Completed snapshot
 -- history is not scanned or inferred absent: positive original-process start
 -- exclusion (not a successor reconstruction) is the authority for this receipt.
 IF EXISTS(SELECT 1 FROM smarter_private.f06_hand_dispatch WHERE permit_id=p_permit_id)
 OR EXISTS(SELECT 1 FROM public.hand_atomic_commits WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_history WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_state_snapshots WHERE table_id=p_table_id AND NOT is_complete AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_private_state WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.table_hole_cards WHERE table_id=p_table_id AND hand_number=p_hand_number) THEN
 RAISE EXCEPTION 'F06_PREPARED_START_EVIDENCE' USING ERRCODE='55000'; END IF;
 INSERT INTO smarter_private.f06_prepared_hand_cancellations
 (permit_id,tournament_id,generation,table_id,lifecycle,hand_number,custody_id)
 VALUES(p_permit_id,p_tournament_id,p_lease_generation,p_table_id,p_lifecycle,p_hand_number,p_custody_id);
 UPDATE smarter_private.f06_hand_permits SET state='never_started',evidence_id=p_permit_id
 WHERE permit_id=p_permit_id RETURNING * INTO h;
 END IF;
 RETURN to_jsonb(h)||jsonb_build_object('ok',true,'lifecycle',h.lifecycle::text,'hand_number',h.hand_number::text);
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_f06_retain_hand_continuation(p_tournament_id uuid, p_lease_generation uuid, p_table_id uuid, p_hand_number bigint, p_sequence bigint, p_payload text, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE h smarter_private.f06_hand_permits; c smarter_private.hand_continuations; v jsonb;
BEGIN
  PERFORM smarter_private.lock_hand_continuation_maintenance_lane();
  PERFORM public.fn_ca_f06_share_table_lane(p_tournament_id, p_lease_generation, p_table_id);
  IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'PLATFORM_FROZEN'; END IF;
  IF p_sequence IS NULL OR p_sequence < 0 OR p_hand_number IS NULL OR p_hand_number < 1
     OR p_payload IS NULL OR octet_length(p_payload) > 1048576
     OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
     OR encode(extensions.digest(p_payload, 'sha256'), 'hex') IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  v := p_payload::jsonb;
  SELECT * INTO h FROM smarter_private.f06_hand_permits
   WHERE table_id = p_table_id AND hand_number = p_hand_number
     AND tournament_id = p_tournament_id FOR SHARE;
  IF h.permit_id IS NULL OR h.state <> 'reserved' OR h.evidence_id IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.tables tb WHERE tb.id = p_table_id
                     AND tb.tournament_id = p_tournament_id AND tb.f06_lifecycle = h.lifecycle)
     OR EXISTS (SELECT 1 FROM public.hand_atomic_commits a
                 WHERE a.table_id = p_table_id AND a.hand_number >= p_hand_number)
     OR EXISTS (SELECT 1 FROM public.hand_history hh
                 WHERE hh.table_id = p_table_id AND hh.hand_number >= p_hand_number)
     OR EXISTS (SELECT 1 FROM smarter_private.hand_submission_dispositions d
                 WHERE d.table_id = p_table_id AND d.hand_number = p_hand_number AND d.disposition = 'disposed') THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ORIGINAL_UNPROVEN' USING ERRCODE = '55000';
  END IF;
  IF v->>'version' IS DISTINCT FROM '1' OR v#>>'{batch,version}' IS DISTINCT FROM '1'
     OR v#>>'{batch,sequence}' IS DISTINCT FROM p_sequence::text
     OR v#>>'{original,tournament_id}' IS DISTINCT FROM h.tournament_id::text
     OR v#>>'{original,table_id}' IS DISTINCT FROM h.table_id::text
     OR v#>>'{original,hand_number}' IS DISTINCT FROM h.hand_number::text
     OR v#>>'{original,permit_id}' IS DISTINCT FROM h.permit_id::text
     OR v#>>'{original,lifecycle}' IS DISTINCT FROM h.lifecycle::text
     OR v#>>'{original,custody_id}' IS DISTINCT FROM h.custody_id::text
     OR v#>>'{original,lease_generation}' IS DISTINCT FROM h.generation::text
     OR jsonb_typeof(v->'seats') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v#>'{batch,events}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v#>'{batch,engine}') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v#>'{batch,controller}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_BINDING_CHANGED' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v->'seats') NOT BETWEEN 2 AND 9
     OR (SELECT count(DISTINCT x->>'user_id') FROM jsonb_array_elements(v->'seats') x)
          <> jsonb_array_length(v->'seats') THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ROSTER_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM smarter_private.hand_continuations
   WHERE table_id = p_table_id AND hand_number = p_hand_number FOR UPDATE;
  IF FOUND THEN
    IF c.writer_generation IS DISTINCT FROM p_lease_generation
       OR c.original_generation IS DISTINCT FROM h.generation OR c.permit_id IS DISTINCT FROM h.permit_id
       OR c.payload::jsonb->'seats' IS DISTINCT FROM v->'seats' THEN
      RAISE EXCEPTION 'HAND_CONTINUATION_WRITER_FENCED' USING ERRCODE = '42501';
    END IF;
    IF c.sequence = p_sequence AND c.payload = p_payload AND c.payload_sha256 = p_sha256 THEN
      RETURN jsonb_build_object('ok', true, 'table_id', p_table_id, 'hand_number', p_hand_number::text,
        'sequence', p_sequence::text, 'sha256', p_sha256, 'writer_generation', c.writer_generation);
    END IF;
    IF p_sequence <> c.sequence + 1 THEN RAISE EXCEPTION 'HAND_CONTINUATION_SEQUENCE_CHANGED' USING ERRCODE = '55000'; END IF;
    UPDATE smarter_private.hand_continuations SET sequence = p_sequence, payload = p_payload,
      payload_sha256 = p_sha256, updated_at = clock_timestamp()
     WHERE table_id = p_table_id AND hand_number = p_hand_number;
  ELSE
    IF h.generation IS DISTINCT FROM p_lease_generation OR p_sequence <> 0
       OR v#>'{batch,events}' <> '[]'::jsonb THEN
      RAISE EXCEPTION 'HAND_CONTINUATION_ANCHOR_REQUIRED' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v->'seats') x
                WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s
                  WHERE s.id::text = x->>'seat_id' AND s.table_id = p_table_id
                    AND s.user_id::text = x->>'user_id' AND s.left_at IS NULL
                    AND s.joined_at = (x->>'seat_joined_at')::timestamptz
                    AND s.stack = (x->>'stack_before')::numeric)) THEN
      RAISE EXCEPTION 'HAND_CONTINUATION_ROSTER_CHANGED' USING ERRCODE = '55000';
    END IF;
    INSERT INTO smarter_private.hand_continuation_dispositions(table_id, hand_number, disposition)
      VALUES(p_table_id, p_hand_number, 'retained') ON CONFLICT(table_id, hand_number) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM smarter_private.hand_continuation_dispositions d
                   WHERE d.table_id = p_table_id AND d.hand_number = p_hand_number AND d.disposition = 'retained') THEN
      RAISE EXCEPTION 'HAND_CONTINUATION_ALREADY_DISPOSED' USING ERRCODE = '55000';
    END IF;
    INSERT INTO smarter_private.hand_continuations
      (table_id, hand_number, tournament_id, permit_id, original_generation, writer_generation,
       sequence, payload, payload_sha256)
    VALUES (p_table_id, p_hand_number, p_tournament_id, h.permit_id, h.generation,
      p_lease_generation, p_sequence, p_payload, p_sha256);
  END IF;
  RETURN jsonb_build_object('ok', true, 'table_id', p_table_id, 'hand_number', p_hand_number::text,
    'sequence', p_sequence::text, 'sha256', p_sha256, 'writer_generation', p_lease_generation);
END $function$
;
