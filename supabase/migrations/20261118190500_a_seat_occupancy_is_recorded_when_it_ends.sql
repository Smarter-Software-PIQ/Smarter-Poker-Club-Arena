-- A seat occupancy is recorded when it ends, so no later reader ever has to
-- guess who sat where from a chair row that has since been reused.
--
-- Follows 20261118164000 (incident d2d79c4f). table_seats rows are reused:
-- when an occupancy ends the row is re-occupied in place and its history is
-- gone. ca_seat_stack_exits is a stack-loss audit and skips zero-stack exits
-- by design, so a player who busts and leaves left no trace at all.
-- smarter_private.cash_seat_occupancy_history keeps every cash occupancy,
-- written at the source by the seat row itself whenever an occupancy ends:
-- left_at stamped, the row handed to another player or occupancy, or the row
-- deleted. Zero stacks included. Tournament and Diamond tables are skipped,
-- exactly as fn_log_seat_stack_exit skips them.
--
-- The dealt-chair evidence reader gains it as its second tier (after the club
-- frozen at deal, before the funding receipt), matched to the exact stint the
-- hand was dealt to: seat, player and join time.
--
-- Audit of every reader of table_seats for a hand's club after the hand's own
-- transaction (full table in the PR): one further reader of the same class,
-- fn_ca_attribute_union_rake, guessed a player's club from the mutable chair
-- with a two-minute tolerance and fell back to the player's latest seat in the
-- past week. It now asks the dealt-chair evidence first; its old reads remain
-- only for hands dealt before the evidence existed.

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS smarter_private.cash_seat_occupancy_history (
  seat_id      uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  joined_at    timestamptz NOT NULL,
  table_id     uuid        NOT NULL,
  occupancy_id uuid,
  club_id      uuid,
  seat_number  integer,
  stack_at_end numeric,
  ended_at     timestamptz NOT NULL,
  end_kind     text        NOT NULL CHECK (end_kind IN ('left', 'reoccupied', 'deleted')),
  recorded_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (seat_id, user_id, joined_at)
);
CREATE INDEX IF NOT EXISTS cash_seat_occupancy_history_player_idx
  ON smarter_private.cash_seat_occupancy_history (table_id, user_id, joined_at);
CREATE INDEX IF NOT EXISTS cash_seat_occupancy_history_recorded_at_idx
  ON smarter_private.cash_seat_occupancy_history (recorded_at);
REVOKE ALL ON smarter_private.cash_seat_occupancy_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION smarter_private.cash_seat_occupancy_history_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  -- Written once, when the occupancy ends. Only the retention prune removes it.
  IF TG_OP = 'DELETE' AND OLD.recorded_at < now() - interval '30 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'cash_seat_occupancy_history_is_immutable' USING ERRCODE = '55000';
END $function$;
REVOKE ALL ON FUNCTION smarter_private.cash_seat_occupancy_history_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cash_seat_occupancy_history_immutable ON smarter_private.cash_seat_occupancy_history;
CREATE TRIGGER cash_seat_occupancy_history_immutable
  BEFORE UPDATE OR DELETE ON smarter_private.cash_seat_occupancy_history
  FOR EACH ROW EXECUTE FUNCTION smarter_private.cash_seat_occupancy_history_immutable();
DROP TRIGGER IF EXISTS cash_seat_occupancy_history_no_truncate ON smarter_private.cash_seat_occupancy_history;
CREATE TRIGGER cash_seat_occupancy_history_no_truncate
  BEFORE TRUNCATE ON smarter_private.cash_seat_occupancy_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cash_provenance_immutable();

CREATE OR REPLACE FUNCTION smarter_private.fn_record_ended_seat_occupancy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_kind text; v_ended timestamptz;
BEGIN
  IF OLD.user_id IS NULL OR OLD.joined_at IS NULL OR OLD.table_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Cash only, exactly the tables fn_log_seat_stack_exit journals.
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.id = OLD.table_id AND t.tournament_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.tables t JOIN public.clubs c ON c.id = t.club_id
                 WHERE t.id = OLD.table_id AND c.asset = 'diamonds') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_kind := 'deleted'; v_ended := COALESCE(OLD.left_at, clock_timestamp());
  ELSIF OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
        AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
        AND NEW.occupancy_id IS NOT DISTINCT FROM OLD.occupancy_id THEN
    v_kind := 'left'; v_ended := NEW.left_at;
  ELSE
    v_kind := 'reoccupied'; v_ended := COALESCE(OLD.left_at, clock_timestamp());
  END IF;
  INSERT INTO smarter_private.cash_seat_occupancy_history
    (seat_id, user_id, joined_at, table_id, occupancy_id, club_id, seat_number, stack_at_end, ended_at, end_kind)
  VALUES (OLD.id, OLD.user_id, OLD.joined_at, OLD.table_id, OLD.occupancy_id, OLD.club_id,
          OLD.seat_number, OLD.stack, v_ended, v_kind)
  ON CONFLICT (seat_id, user_id, joined_at) DO NOTHING;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_record_ended_seat_occupancy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_record_ended_seat_occupancy ON public.table_seats;
CREATE TRIGGER zz_record_ended_seat_occupancy
  AFTER UPDATE OF user_id, occupancy_id, left_at ON public.table_seats
  FOR EACH ROW
  WHEN (OLD.user_id IS NOT NULL AND (
        OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.occupancy_id IS DISTINCT FROM NEW.occupancy_id
     OR (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)))
  EXECUTE FUNCTION smarter_private.fn_record_ended_seat_occupancy();
DROP TRIGGER IF EXISTS zz_record_deleted_seat_occupancy ON public.table_seats;
CREATE TRIGGER zz_record_deleted_seat_occupancy
  AFTER DELETE ON public.table_seats
  FOR EACH ROW
  WHEN (OLD.user_id IS NOT NULL)
  EXECUTE FUNCTION smarter_private.fn_record_ended_seat_occupancy();

CREATE OR REPLACE FUNCTION smarter_private.cash_hand_earning_club_evidence(p_hand_id uuid, p_table_id uuid, p_player_id uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_number bigint; v_seat uuid; v_join timestamptz; v_receipts uuid[]; v_clubs uuid[];
BEGIN
  SELECT a.hand_number INTO v_number FROM public.hand_atomic_commits a
   WHERE a.hand_id = p_hand_id AND a.table_id = p_table_id;
  IF v_number IS NULL THEN RETURN NULL; END IF;

  -- 1. The chair the player was dealt in, frozen with the hand.
  SELECT array_agg(c.club_id) INTO v_clubs FROM smarter_private.cash_hand_chair_clubs c
   WHERE c.table_id = p_table_id AND c.hand_number = v_number
     AND c.user_id = p_player_id AND c.club_id IS NOT NULL;
  IF v_clubs IS NOT NULL THEN RETURN v_clubs; END IF;

  -- The dealt manifest names the exact stint, and the receipts that funded it.
  SELECT (e->>'seat_id')::uuid, (e->>'seat_joined_at')::timestamptz,
         (SELECT array_agg(DISTINCT (r->>'funding_club_id')::uuid)
            FROM jsonb_array_elements(e->'funding_receipts') r
           WHERE r->>'funding_club_id' IS NOT NULL)
    INTO v_seat, v_join, v_receipts
    FROM public.cash_hand_participant_manifests m
    CROSS JOIN LATERAL jsonb_array_elements(m.participants) e
   WHERE m.table_id = p_table_id AND m.hand_number = v_number
     AND (e->>'user_id')::uuid = p_player_id;

  -- 2. That exact stint's chair, recorded by the seat row when it ended.
  IF v_seat IS NOT NULL AND v_join IS NOT NULL THEN
    SELECT ARRAY[o.club_id] INTO v_clubs FROM smarter_private.cash_seat_occupancy_history o
     WHERE o.seat_id = v_seat AND o.user_id = p_player_id AND o.joined_at = v_join
       AND o.table_id = p_table_id AND o.club_id IS NOT NULL;
    IF v_clubs IS NOT NULL THEN RETURN v_clubs; END IF;
  END IF;

  -- 3. The receipts that funded the stint.
  IF v_receipts IS NOT NULL THEN RETURN v_receipts; END IF;
  IF v_seat IS NULL OR v_join IS NULL THEN RETURN NULL; END IF;

  -- 4. The exit journal's snapshot of that exact chair when it was vacated.
  SELECT ARRAY[x.club_id] INTO v_clubs FROM public.ca_seat_stack_exits x
   WHERE x.user_id = p_player_id AND x.table_id = p_table_id AND x.seat_id = v_seat
     AND x.occurred_at >= v_join AND x.club_id IS NOT NULL
   ORDER BY x.occurred_at LIMIT 1;
  RETURN v_clubs;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.cash_hand_earning_club_evidence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_ca_attribute_union_rake(p_hours integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(p_hours, 3), 168)));
  v_rows int := 0; v_attributed int := 0; v_unattributed int := 0;
  v_records int := 0;
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role only' USING ERRCODE = '42501';
  END IF;

  /* the hands: rake at a table owned by a union's house club (tables.club_id
     = the union's id), in the window, either never attributed or still
     carrying an unattributed player under six hours old */
  CREATE TEMP TABLE _ura_hands ON COMMIT DROP AS
  SELECT r.id AS rake_record_id, r.hand_id, r.table_id, r.club_id AS union_id,
         r.created_at AS played_at, r.rake_amount, r.player_contributions
    FROM public.rake_records r
   WHERE r.is_tournament IS NOT TRUE
     AND r.rake_amount > 0
     AND r.created_at >= v_since
     AND r.player_contributions IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.unions u WHERE u.id = r.club_id)
     AND (NOT EXISTS (SELECT 1 FROM public.ca_union_rake_attribution a WHERE a.rake_record_id = r.id)
          OR EXISTS (SELECT 1 FROM public.ca_union_rake_attribution a
                      WHERE a.rake_record_id = r.id AND a.club_id IS NULL
                        AND a.attempts < 6 AND r.created_at >= now() - interval '6 hours'));
  SELECT count(*) INTO v_records FROM _ura_hands;

  CREATE TEMP TABLE _ura_contrib ON COMMIT DROP AS
  SELECT h.rake_record_id, h.hand_id, h.table_id, h.union_id, h.played_at, h.rake_amount,
         (x.key)::uuid AS user_id, (x.value)::numeric AS contrib,
         sum((x.value)::numeric) OVER (PARTITION BY h.rake_record_id) AS total
    FROM _ura_hands h, jsonb_each_text(h.player_contributions) x
   WHERE (x.value)::numeric > 0;

  /* the seat covering the hand's instant: same table first, else the
     player's latest seat that covers it */
  CREATE TEMP TABLE _ura_attr ON COMMIT DROP AS
  SELECT c.rake_record_id, c.user_id, c.union_id, c.table_id, c.hand_id, c.played_at,
         COALESCE(
           /* the chair the hand was dealt to, from evidence frozen at deal
              (20261118): never a guess from a reused chair row */
           (SELECT e[1] FROM smarter_private.cash_hand_earning_club_evidence(c.hand_id, c.table_id, c.user_id) e
             WHERE cardinality(e) = 1),
           /* hands dealt before that evidence existed */
           (SELECT s.club_id FROM public.table_seats s
             WHERE s.table_id = c.table_id AND s.user_id = c.user_id
               AND s.joined_at <= c.played_at
               AND COALESCE(s.left_at, 'infinity'::timestamptz) >= c.played_at - interval '2 minutes'
               AND s.club_id IS NOT NULL
             ORDER BY s.joined_at DESC LIMIT 1),
           (SELECT s.club_id FROM public.table_seats s
             WHERE s.user_id = c.user_id
               AND s.joined_at <= c.played_at
               AND COALESCE(s.left_at, 'infinity'::timestamptz) >= c.played_at - interval '2 minutes'
               AND s.club_id IS NOT NULL
             ORDER BY s.joined_at DESC LIMIT 1),
           /* the seat row itself may be gone (a table torn down deletes its
              seats): the club the player last sat through in the past week
              is the club they play through */
           (SELECT s.club_id FROM public.table_seats s
             WHERE s.user_id = c.user_id
               AND s.joined_at <= c.played_at
               AND s.joined_at >= c.played_at - interval '7 days'
               AND s.club_id IS NOT NULL
             ORDER BY s.joined_at DESC LIMIT 1)
         ) AS club_id,
         round(c.rake_amount * c.contrib / NULLIF(c.total, 0), 4) AS rake_share
    FROM _ura_contrib c;

  INSERT INTO public.ca_union_rake_attribution AS a
        (rake_record_id, user_id, union_id, table_id, hand_id, played_at, club_id, rake_share, attempts, attributed_at)
  SELECT rake_record_id, user_id, union_id, table_id, hand_id, played_at, club_id, COALESCE(rake_share, 0), 1, now()
    FROM _ura_attr
  ON CONFLICT (rake_record_id, user_id) DO UPDATE
     SET club_id       = COALESCE(EXCLUDED.club_id, a.club_id),
         rake_share    = EXCLUDED.rake_share,
         attempts      = a.attempts + 1,
         attributed_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT count(*) FILTER (WHERE club_id IS NOT NULL), count(*) FILTER (WHERE club_id IS NULL)
    INTO v_attributed, v_unattributed
    FROM _ura_attr;

  RETURN jsonb_build_object('since', v_since, 'records', v_records, 'rows', v_rows,
                            'attributed', v_attributed, 'unattributed', v_unattributed);
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_attribute_union_rake(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_attribute_union_rake(integer) TO service_role;

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
       OR (v_name = 'public.fn_ca_attribute_union_rake'
          AND strpos(v_src, 'smarter_private.cash_hand_earning_club_evidence(') = 0)
       OR (v_name = 'smarter_private.fn_record_ended_seat_occupancy'
          AND strpos(v_src, 'INSERT INTO smarter_private.cash_seat_occupancy_history') = 0)
       OR (v_name = 'smarter_private.cash_hand_earning_club_evidence'
          AND (strpos(v_src, 'smarter_private.cash_hand_chair_clubs') = 0
            OR strpos(v_src, 'smarter_private.cash_seat_occupancy_history') = 0
            OR strpos(v_src, 'public.cash_hand_participant_manifests') = 0
            OR strpos(v_src, 'public.ca_seat_stack_exits') = 0)) THEN
      RAISE EXCEPTION 'REFUSED: % would drop the dealt-chair rake provenance law', v_name
        USING ERRCODE = '42501',
              DETAIL = 'A stored cash rake banks after its chair row can be reused. Without the evidence frozen at deal and the occupancy history it can never bank (incident d2d79c4f, 2026-11-18).',
              HINT = 'Keep the chair capture, the occupancy history writer and the cash_hand_earning_club_evidence reads.';
    END IF;
  END LOOP;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_cash_rake_provenance_law_guard() FROM PUBLIC, anon, authenticated;

-- periodic-work: retention only. The rows are seat history a stored rake reads within minutes;
-- the prune repairs nothing and compensates for nothing, and a missed run only keeps rows longer.
SELECT cron.schedule('ca-cash-seat-occupancy-history-prune-daily', '40 5 * * *',
  $cron$DELETE FROM smarter_private.cash_seat_occupancy_history WHERE recorded_at < now() - interval '30 days'$cron$);

COMMIT;
