-- A deferred cash rake proves its earning club from the hand's own deal, never
-- from a chair row that has since been handed to someone else.
--
-- INCIDENT d2d79c4f (2026-11-18 16:20 UTC, fn_post_commit_stranded_watchdog):
-- since 20261118034950 a cash hand's rake is stored in cash_rake_pending and
-- banked by fn_ca_bank_pending_cash_rake after the hand's own transaction.
-- atomic_distribute_rake asks fn_cash_earning_club which club earned each
-- contributor's share, and on a shared-union table that reader looked ONLY at
-- the live table_seats row whose stint covered the hand start. Chair rows are
-- reused: horse 7c0be9c9 (Deep Stack Society) played hand 59989058 on PLO6
-- Classic Main 2 from chair 1a293fbc, left at 16:09:51, and the same row was
-- re-occupied seconds later. The stored obligation then refused with 23514
-- cash_earning_seat_provenance_missing_or_ambiguous on every attempt (700+),
-- and every later rake on that table queued behind it.
--
-- The fix freezes the evidence at the only moment it is certain. At deal,
-- fn_cash_capture_hand_manifest already locks the exact chair row (seat id,
-- occupancy, join time, left_at IS NULL) for every participant; it now writes
-- that chair's club into smarter_private.cash_hand_chair_clubs in the same
-- transaction. When the live chair is gone, fn_cash_earning_club reads, in
-- order: that frozen chair club; the dealt manifest's funding receipts for the
-- stint; the exit journal's snapshot of that exact chair. An overlapping
-- live chair still answers first and an ambiguous answer still refuses.
--
-- Hardening: an event trigger refuses any later redefinition of these three
-- functions that drops the law, and the frozen rows are immutable (only rows
-- older than 14 days may be deleted, by the daily prune).

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS smarter_private.cash_hand_chair_clubs (
  table_id       uuid        NOT NULL,
  hand_number    bigint      NOT NULL,
  user_id        uuid        NOT NULL,
  seat_id        uuid        NOT NULL,
  occupancy_id   uuid        NOT NULL,
  seat_joined_at timestamptz NOT NULL,
  club_id        uuid,
  captured_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (table_id, hand_number, user_id)
);
CREATE INDEX IF NOT EXISTS cash_hand_chair_clubs_captured_at_idx
  ON smarter_private.cash_hand_chair_clubs (captured_at);
REVOKE ALL ON smarter_private.cash_hand_chair_clubs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION smarter_private.cash_hand_chair_clubs_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  -- Evidence for a hand is written once, at deal. Only the retention prune
  -- may remove it, and only once no stored obligation can still need it.
  IF TG_OP = 'DELETE' AND OLD.captured_at < now() - interval '14 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'cash_hand_chair_clubs_is_immutable' USING ERRCODE = '55000';
END $function$;
REVOKE ALL ON FUNCTION smarter_private.cash_hand_chair_clubs_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cash_hand_chair_clubs_immutable ON smarter_private.cash_hand_chair_clubs;
CREATE TRIGGER cash_hand_chair_clubs_immutable
  BEFORE UPDATE OR DELETE ON smarter_private.cash_hand_chair_clubs
  FOR EACH ROW EXECUTE FUNCTION smarter_private.cash_hand_chair_clubs_immutable();
DROP TRIGGER IF EXISTS cash_hand_chair_clubs_no_truncate ON smarter_private.cash_hand_chair_clubs;
CREATE TRIGGER cash_hand_chair_clubs_no_truncate
  BEFORE TRUNCATE ON smarter_private.cash_hand_chair_clubs
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cash_provenance_immutable();

CREATE OR REPLACE FUNCTION smarter_private.cash_hand_earning_club_evidence(p_hand_id uuid, p_table_id uuid, p_player_id uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_number bigint; v_seat uuid; v_join timestamptz; v_clubs uuid[];
BEGIN
  SELECT a.hand_number INTO v_number FROM public.hand_atomic_commits a
   WHERE a.hand_id = p_hand_id AND a.table_id = p_table_id;
  IF v_number IS NULL THEN RETURN NULL; END IF;

  -- 1. The chair the player was dealt in, frozen with the hand.
  SELECT array_agg(c.club_id) INTO v_clubs FROM smarter_private.cash_hand_chair_clubs c
   WHERE c.table_id = p_table_id AND c.hand_number = v_number
     AND c.user_id = p_player_id AND c.club_id IS NOT NULL;
  IF v_clubs IS NOT NULL THEN RETURN v_clubs; END IF;

  -- 2. The dealt manifest: the stint, and the receipts that funded it.
  SELECT (e->>'seat_id')::uuid, (e->>'seat_joined_at')::timestamptz,
         (SELECT array_agg(DISTINCT (r->>'funding_club_id')::uuid)
            FROM jsonb_array_elements(e->'funding_receipts') r
           WHERE r->>'funding_club_id' IS NOT NULL)
    INTO v_seat, v_join, v_clubs
    FROM public.cash_hand_participant_manifests m
    CROSS JOIN LATERAL jsonb_array_elements(m.participants) e
   WHERE m.table_id = p_table_id AND m.hand_number = v_number
     AND (e->>'user_id')::uuid = p_player_id;
  IF v_clubs IS NOT NULL THEN RETURN v_clubs; END IF;
  IF v_seat IS NULL OR v_join IS NULL THEN RETURN NULL; END IF;

  -- 3. The exit journal's snapshot of that exact chair when it was vacated.
  SELECT ARRAY[x.club_id] INTO v_clubs FROM public.ca_seat_stack_exits x
   WHERE x.user_id = p_player_id AND x.table_id = p_table_id AND x.seat_id = v_seat
     AND x.occurred_at >= v_join AND x.club_id IS NOT NULL
   ORDER BY x.occurred_at LIMIT 1;
  RETURN v_clubs;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.cash_hand_earning_club_evidence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_cash_earning_club(p_hand_id uuid, p_table_id uuid, p_player_id uuid, p_source_club uuid, p_union_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE started timestamptz;clubs uuid[];chair uuid[];paid uuid[];
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_hand_id IS NULL OR p_table_id IS NULL OR p_player_id IS NULL OR p_source_club IS NULL THEN
  RAISE EXCEPTION 'cash_earning_identity_missing' USING ERRCODE='23514'; END IF;
 SELECT h.started_at INTO started FROM public.hand_history h WHERE h.id=p_hand_id AND h.table_id=p_table_id;
 -- Original off-chair custody exists only in the accepted native hand's
 -- transaction. Never derive ownership from today's replacement chair.
 IF started IS NOT NULL AND isfinite(started) AND started<=transaction_timestamp() THEN
  SELECT array_agg(DISTINCT r.funding_club_id) INTO clubs
  FROM smarter_private.retired_cash_hand_custody r
  JOIN smarter_private.retired_cash_hand_qualification q USING(submission_id)
  JOIN smarter_private.hand_submissions s USING(submission_id)
  JOIN smarter_private.hand_submission_handoffs h USING(submission_id)
  JOIN public.hand_atomic_commits a ON a.hand_id=r.submission_id
   AND a.table_id=r.table_id AND a.hand_number=r.hand_number
  WHERE r.submission_id=p_hand_id AND r.table_id=p_table_id AND r.user_id=p_player_id
   AND r.state='consumed' AND r.transaction_id=txid_current()
   AND h.transaction_id=r.transaction_id AND h.request_hash=r.request_hash
   AND s.request_hash=r.request_hash AND q.request_hash=r.request_hash
   AND r.accepted_time_bank=r.original_time_bank AND r.settlement_id IS NOT NULL
   AND (q.table_id,q.hand_number)=(r.table_id,r.hand_number)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.expected->'participants') e
    WHERE (e#>>'{stack,user_id}')::uuid=r.user_id
     AND (e#>>'{stack,seat_id}')::uuid=r.seat_id
     AND (e#>>'{stack,occupancy_id}')::uuid=r.occupancy_id
     AND (e#>>'{stack,seat_joined_at}')::timestamptz=r.seat_joined_at
     AND (e#>>'{stack,stack_before}')::numeric=r.stack_before
     AND (e#>>'{stack,stack}')::numeric=r.stack_after
     AND (e->>'funding_club_id')::uuid=r.funding_club_id);
  IF cardinality(clubs)=1 AND clubs[1] IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=clubs[1]
    AND (c.is_union IS NOT TRUE OR (p_union_id IS NOT NULL AND (c.id=p_union_id OR c.union_id=p_union_id))))
  THEN RETURN clubs[1]; END IF;
 END IF;
 -- Funding must exist by the persisted actual hand start. The logical formed_at
 -- supplied by the engine can precede the transaction that opens its slot.
 -- A pooled Lightning hand is funded by its original pool/cash session,
 -- not a physical chair at the synthetic host table. Anchor seats can be
 -- elsewhere or already gone by settlement; their session is retained.
 IF EXISTS(SELECT 1 FROM public.lightning_hand h
   WHERE h.hand_history_id=p_hand_id AND h.host_table_id=p_table_id) THEN
  IF started IS NULL OR NOT isfinite(started) OR started>transaction_timestamp() THEN
   RAISE EXCEPTION 'cash_hand_start_not_recorded' USING ERRCODE='23514'; END IF;
  -- The earning club is the club whose wallet funded the anchor chair, as
  -- for every Classic chair. cash_player_session.club_id is the TABLE's club,
  -- which on a union-hosted game is the union itself, not the funding club.
  SELECT array_agg(DISTINCT s.club_id) FILTER (WHERE s.club_id IS NOT NULL),
         array_agg(DISTINCT r.funding_club_id) FILTER (WHERE r.funding_club_id IS NOT NULL),
         array_agg(DISTINCT cs.club_id)
    INTO chair, paid, clubs
   FROM public.lightning_hand h
   JOIN public.lightning_hand_player hp ON hp.hand_id=h.hand_id
    AND hp.player_id=p_player_id AND hp.cluster_id=h.cluster_id AND hp.cluster_epoch=h.cluster_epoch
   JOIN public.lightning_pool_slot sl ON sl.id=hp.pool_slot_id AND sl.player_id=hp.player_id
    AND sl.cluster_id=h.cluster_id AND sl.cluster_epoch=h.cluster_epoch
   JOIN public.lightning_pool_session ps ON ps.id=sl.pool_session_id AND ps.player_id=hp.player_id
    AND ps.cluster_id=h.cluster_id AND ps.cluster_epoch=h.cluster_epoch
   JOIN public.cash_player_session cs ON cs.id=ps.cash_player_session_id AND cs.player_id=hp.player_id
   LEFT JOIN public.table_seats s ON s.id=ps.anchor_seat_id AND s.user_id=hp.player_id
    AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started)
   -- A chair row can be gone by settlement; its buy-in receipt is immutable.
   LEFT JOIN LATERAL (
    SELECT f.funding_club_id FROM public.cash_participant_funding_receipts f
     WHERE smarter_private.cash_initial_funding_receipt(f.id) IS TRUE AND f.table_id=cs.table_id
      AND (f.account_entity_id=hp.player_id OR (f.operation_kind='horse_funding' AND smarter_private.cash_initial_funding_receipt(f.id) IS TRUE))
      AND f.user_id=hp.player_id AND f.seat_id=ps.anchor_seat_id
      AND f.seat_joined_at<=ps.entered_at AND f.recorded_at<=started
     ORDER BY f.seat_joined_at DESC, f.recorded_at DESC, f.id DESC LIMIT 1) r ON true
   WHERE h.hand_history_id=p_hand_id AND h.host_table_id=p_table_id
    AND h.formed_at<=started AND ps.entered_at<=started AND sl.opened_at<=started
    AND cs.opened_at<=started
    AND (ps.exited_at IS NULL OR ps.exited_at>started)
    AND (sl.closed_at IS NULL OR sl.closed_at>started)
    AND (cs.closed_at IS NULL OR cs.closed_at>started);
  IF cardinality(chair)=1
   AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=chair[1]
    AND (c.is_union IS NOT TRUE OR (p_union_id IS NOT NULL AND (c.id=p_union_id OR c.union_id=p_union_id))))
  THEN RETURN chair[1]; END IF;
  IF chair IS NULL AND cardinality(paid)=1
   AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=paid[1]
    AND (c.is_union IS NOT TRUE OR (p_union_id IS NOT NULL AND (c.id=p_union_id OR c.union_id=p_union_id))))
  THEN RETURN paid[1]; END IF;
  -- No unambiguous funding chair: the original session reader, unchanged.
  IF cardinality(clubs)=1 AND clubs[1] IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=clubs[1]
    AND (c.is_union IS NOT TRUE OR (p_union_id IS NOT NULL AND (c.id=p_union_id OR c.union_id=p_union_id))))
  THEN RETURN clubs[1]; END IF;
  IF p_union_id IS NOT NULL THEN
   RAISE EXCEPTION 'cash_earning_seat_provenance_missing_or_ambiguous' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF p_union_id IS NULL THEN
  -- Private games may admit a seat funded by another club. Preserve the
  -- actual club at the hand's start; the host only identifies the bank route.
  -- This reader runs before banking an already accepted hand. Unknown seat
  -- evidence must therefore stay NULL, not abort its bank obligation or invent
  -- host ownership. The existing source worker durably refuses that NULL or
  -- an unsupported cross-club liability after the exact bank receipt exists.
  IF started IS NULL OR NOT isfinite(started) OR started>transaction_timestamp() THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT s.club_id) INTO clubs FROM public.table_seats s
   WHERE s.table_id=p_table_id AND s.user_id=p_player_id
    AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);
  IF clubs IS NULL THEN clubs:=smarter_private.cash_hand_earning_club_evidence(p_hand_id,p_table_id,p_player_id); END IF;
  -- An overlapping unknown-club seat also makes the evidence ambiguous.
  IF cardinality(clubs) IS DISTINCT FROM 1 OR clubs[1] IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=clubs[1] AND c.is_union IS NOT TRUE)
  THEN RETURN NULL; END IF;
  RETURN clubs[1];
 END IF;
 -- Preserve the existing shared-union validation and failure contract.
 IF started IS NULL OR started>transaction_timestamp() THEN RAISE EXCEPTION 'cash_hand_start_not_recorded' USING ERRCODE='23514'; END IF;
 SELECT array_agg(DISTINCT s.club_id) INTO clubs FROM public.table_seats s
  WHERE s.table_id=p_table_id AND s.user_id=p_player_id AND s.club_id IS NOT NULL
   AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);
 -- The chair row can be reused before a stored rake banks: fall back to the
 -- evidence frozen at deal (20261118 dealt-chair provenance).
 IF clubs IS NULL THEN clubs:=smarter_private.cash_hand_earning_club_evidence(p_hand_id,p_table_id,p_player_id); END IF;
 IF cardinality(clubs) IS DISTINCT FROM 1
  OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=clubs[1]
   AND (c.is_union IS NOT TRUE OR c.id=p_union_id OR c.union_id=p_union_id))
 THEN RAISE EXCEPTION 'cash_earning_seat_provenance_missing_or_ambiguous' USING ERRCODE='23514'; END IF;
 RETURN clubs[1];
END $function$;

CREATE OR REPLACE FUNCTION public.fn_cash_capture_hand_manifest(p_table_id uuid, p_hand_number bigint, p_participants jsonb, p_instance_id text, p_lease_generation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t public.tables%ROWTYPE; h public.clubs%ROWTYPE; s public.table_seats%ROWTYPE;
 prior public.cash_hand_participant_manifests%ROWTYPE;
 x jsonb; v_users uuid[]:=ARRAY[]::uuid[]; v_occupancies uuid[]:=ARRAY[]::uuid[];
 v_roster jsonb:='[]'; v_request jsonb; v_scope jsonb; v_issues jsonb:='[]';
 v_lineage jsonb; v_funding jsonb; v_initial integer; v_accounts integer; v_id uuid; v_user uuid;
 v_seat uuid; v_occupancy uuid; v_join timestamptz; v_before numeric; v_complete boolean:=true; v_chairs jsonb:='[]';
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501'; END IF;
 IF p_table_id IS NULL OR p_hand_number IS NULL OR p_hand_number<1000000
 OR jsonb_typeof(p_participants) IS DISTINCT FROM 'array' OR jsonb_array_length(p_participants)<2
 OR jsonb_array_length(p_participants)>10 OR p_instance_id IS NULL OR p_lease_generation IS NULL THEN
  RAISE EXCEPTION 'Invalid original cash manifest' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.engine_table_leases l WHERE l.table_id=p_table_id
  AND l.instance_id=p_instance_id AND l.lease_generation=p_lease_generation AND l.protocol_version=2
  AND l.heartbeat_at>=clock_timestamp()-make_interval(secs=>public.fn_engine_lease_stale_seconds()) FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original cash manifest lease stale' USING ERRCODE='55000'; END IF;
 SELECT jsonb_agg(value ORDER BY value->>'user_id') INTO v_request FROM jsonb_array_elements(p_participants);
 SELECT * INTO prior FROM public.cash_hand_participant_manifests WHERE table_id=p_table_id AND hand_number=p_hand_number;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM v_request OR prior.lease_instance_id IS DISTINCT FROM p_instance_id
   OR prior.lease_generation IS DISTINCT FROM p_lease_generation THEN
   RAISE EXCEPTION 'Original cash manifest identity reused' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('version',1,'manifest_id',prior.id,'funding_provenance_complete',prior.funding_provenance_complete,'issues',prior.issues);
 END IF;
 SELECT * INTO STRICT t FROM public.tables WHERE id=p_table_id FOR SHARE;
 IF t.tournament_id IS NOT NULL THEN RAISE EXCEPTION 'Tournament chips are not cash provenance' USING ERRCODE='22023'; END IF;
 SELECT * INTO h FROM public.clubs WHERE id=t.club_id;
 v_scope:=jsonb_build_object('host_club_id',t.club_id,'game_union_id',CASE WHEN t.is_private THEN NULL ELSE t.union_id END,
  'is_private',t.is_private,'tournament_id',t.tournament_id,'asset',h.asset,'unit_scale',2);
 IF h.id IS NULL OR h.asset IS DISTINCT FROM 'chips' OR t.is_private IS NULL
  OR (NOT t.is_private AND t.union_id IS NULL) THEN
  v_issues:=v_issues||'"game_asset_or_union_scope_unproven"'::jsonb; v_complete:=false; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(v_request) LOOP
  v_user:=(x->>'user_id')::uuid; v_seat:=(x->>'seat_id')::uuid;
  v_occupancy:=(x->>'occupancy_id')::uuid; v_join:=(x->>'seat_joined_at')::timestamptz;
  v_before:=(x->>'stack_before')::numeric;
  IF v_user IS NULL OR v_seat IS NULL OR v_occupancy IS NULL OR v_join IS NULL
   OR NOT isfinite(v_join) OR v_user=ANY(v_users) OR v_occupancy=ANY(v_occupancies)
   OR jsonb_typeof(x->'is_horse') IS DISTINCT FROM 'boolean' OR jsonb_typeof(x->'stack_before') IS DISTINCT FROM 'number'
   OR v_before IS NULL OR v_before<0 OR v_before<>round(v_before,2)
   OR v_before::text IN ('NaN','Infinity','-Infinity') THEN
   RAISE EXCEPTION 'Invalid or duplicate cash participant' USING ERRCODE='22023'; END IF;
  v_users:=array_append(v_users,v_user); v_occupancies:=array_append(v_occupancies,v_occupancy);
  SELECT * INTO s FROM public.table_seats WHERE id=v_seat AND table_id=p_table_id AND user_id=v_user
   AND occupancy_id=v_occupancy AND joined_at=v_join AND left_at IS NULL FOR SHARE;
  IF NOT FOUND OR s.stack IS DISTINCT FROM v_before THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','original_seat_or_starting_stack_unproven','user_id',v_user));
   v_complete:=false;
  END IF;
  -- The chair this player is dealt in, frozen with the hand (20261118).
  IF s.id=v_seat AND s.user_id=v_user AND s.occupancy_id=v_occupancy AND s.joined_at=v_join THEN
   v_chairs:=v_chairs||jsonb_build_array(jsonb_build_object('u',v_user,'s',v_seat,'o',v_occupancy,'j',v_join,'c',s.club_id));
  END IF;
  v_lineage:=public.fn_cash_original_funding_lineage(v_user,p_table_id,v_seat,v_occupancy,v_join,clock_timestamp(),false);
  v_funding:=v_lineage->'funding_receipts';
  SELECT count(*) FILTER(WHERE smarter_private.cash_initial_funding_receipt(f.id) IS TRUE),count(DISTINCT (f.funding_club_id,f.funding_union_id,f.asset))
   INTO v_initial,v_accounts FROM jsonb_array_elements(v_funding) ref
   JOIN public.cash_participant_funding_receipts f ON f.id=(ref->>'id')::uuid;
  IF v_lineage->'issues'<>'[]'::jsonb THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','original_cash_move_lineage_unproven','user_id',v_user,'details',v_lineage->'issues'));
   v_complete:=false;
  END IF;
  IF v_initial<>1 OR v_accounts<>1 THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason',CASE WHEN v_initial<>1 THEN 'original_admission_funding_missing' ELSE 'mixed_funding_account_ownership_unproven' END,'user_id',v_user));
   v_complete:=false;
  END IF;
  IF EXISTS(SELECT 1 FROM public.cash_participant_funding_receipts f
    LEFT JOIN public.cash_funding_application_receipts a ON a.funding_receipt_id=f.id
    WHERE f.id IN(SELECT (ref->>'id')::uuid FROM jsonb_array_elements(v_funding) ref) AND f.pending_addon_id IS NOT NULL
     AND (a.pending_addon_id IS NULL OR (a.applied>0 AND a.applied_occupancy_id IS DISTINCT FROM f.occupancy_id))) THEN
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object('reason','pending_funding_application_unproven','user_id',v_user));
   v_complete:=false;
  END IF;
  v_roster:=v_roster||jsonb_build_array(jsonb_build_object('user_id',v_user,'seat_id',v_seat,
   'seat_joined_at',x->>'seat_joined_at','occupancy_id',v_occupancy,'stack_before',v_before,
   'is_horse',(x->>'is_horse')::boolean,'funding_receipts',v_funding,'funding_lineage',v_lineage));
 END LOOP;
 INSERT INTO public.cash_hand_participant_manifests(table_id,hand_number,lease_instance_id,lease_generation,
  request,game_scope,participants,issues,funding_provenance_complete)
 VALUES(p_table_id,p_hand_number,p_instance_id,p_lease_generation,v_request,v_scope,v_roster,v_issues,v_complete)
 RETURNING id INTO v_id;
 INSERT INTO smarter_private.cash_hand_chair_clubs(table_id,hand_number,user_id,seat_id,occupancy_id,seat_joined_at,club_id)
 SELECT p_table_id,p_hand_number,(x->>'u')::uuid,(x->>'s')::uuid,(x->>'o')::uuid,(x->>'j')::timestamptz,(x->>'c')::uuid
   FROM jsonb_array_elements(v_chairs) x
 ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('version',1,'manifest_id',v_id,'funding_provenance_complete',v_complete,'issues',v_issues);
END $function$;

CREATE OR REPLACE FUNCTION smarter_private.fn_cash_rake_provenance_law_guard()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE obj record; v_name text; v_src text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE object_type = 'function' LOOP
    SELECT n.nspname || '.' || p.proname, p.prosrc INTO v_name, v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = obj.objid;
    IF (v_name = 'public.fn_cash_earning_club'
          AND strpos(v_src, 'smarter_private.cash_hand_earning_club_evidence(') = 0)
       OR (v_name = 'public.fn_cash_capture_hand_manifest'
          AND strpos(v_src, 'INSERT INTO smarter_private.cash_hand_chair_clubs') = 0)
       OR (v_name = 'smarter_private.cash_hand_earning_club_evidence'
          AND (strpos(v_src, 'smarter_private.cash_hand_chair_clubs') = 0
            OR strpos(v_src, 'public.cash_hand_participant_manifests') = 0
            OR strpos(v_src, 'public.ca_seat_stack_exits') = 0)) THEN
      RAISE EXCEPTION 'REFUSED: % would drop the dealt-chair rake provenance law', v_name
        USING ERRCODE = '42501',
              DETAIL = 'A stored cash rake banks after its chair row can be reused. Without the evidence frozen at deal it can never bank (incident d2d79c4f, 2026-11-18).',
              HINT = 'Keep the chair capture in fn_cash_capture_hand_manifest and the cash_hand_earning_club_evidence fallback in fn_cash_earning_club.';
    END IF;
  END LOOP;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_cash_rake_provenance_law_guard() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS ca_cash_rake_provenance_law;
CREATE EVENT TRIGGER ca_cash_rake_provenance_law ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION')
  EXECUTE FUNCTION smarter_private.fn_cash_rake_provenance_law_guard();

-- periodic-work: retention only. The rows are deal-time evidence a stored rake reads within minutes;
-- the prune repairs nothing and compensates for nothing, and a missed run only keeps rows longer.
SELECT cron.schedule('ca-cash-hand-chair-clubs-prune-daily', '35 5 * * *',
  $cron$DELETE FROM smarter_private.cash_hand_chair_clubs WHERE captured_at < now() - interval '14 days'$cron$);
