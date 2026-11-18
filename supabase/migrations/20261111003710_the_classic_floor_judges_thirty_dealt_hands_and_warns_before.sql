-- ═══════════════════════════════════════════════════════════════════════════
-- THE CLASSIC FLOOR JUDGES THIRTY DEALT HANDS, AND WARNS BEFORE IT BOOTS
-- (Dan, owner ruling 2026-11-10)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan, verbatim: "FOR ALL CLASSIC GAMES THAT ARE .50/1.00 OR HIGHER, YOU MUST
-- ADD A NEW 20% VPIP ON THOSE GAMES, OR THE PLAYER GETS BOOTED." Then, on the
-- four open values: humans and horses alike, a ROLLING THIRTY dealt hands with
-- a thirty-hand minimum, PER-VARIANT floors, and WARN-THEN-BOOT with a safe
-- stack cashout. Action and Madness are unchanged.
--
-- WHAT ALREADY EXISTED, AND IS NOT REBUILT HERE. The nit/VPIP rule has been
-- live since 20260825_nit_game_vpip_rules_are_enforced: `tables.nit_game` is
-- the master switch, `maintain_percent_min` the floor, `maintain_hands` the
-- sample minimum; fn_nit_check judges, fn_nit_evictions lists, fn_nit_status
-- and fn_cash_vpip_status show, and the dealing loop stands a seat up at a
-- HAND BOUNDARY through atomicCashout with leaveMode 'vpip_evicted' (which
-- writes Dan's two-hour bar, 2026-09-05). Horses are in scope already
-- (CLAUDE.md 10.5). Forced blinds already cannot count as voluntary: VPIP is
-- own `call` or {bet,raise,all_in} in deriveFlowFlags, and blind posts never
-- reach the action log. This migration adds three things to that machine and
-- changes nothing else.
--
-- 1. PER-VARIANT FLOORS AS CONFIG, NOT CODE. fn_cash_template_defaults is
--    IMMUTABLE, so it cannot read a table; it keeps returning the static
--    template promise. The Classic floor arrives in the ONE trigger that
--    writes the game's promise on every write to cash_games
--    (fn_cash_game_floor_from_template). Because fn_cash_cluster_open_table
--    and fn_cash_apply_ruleset BOTH derive nit_game / maintain_percent_min /
--    maintain_hands from `ruleset_snapshot`, a floor written there reaches
--    every table the game opens from now on, and every table it already has,
--    with no change to the creation path. That is what makes the policy
--    survive new tables and engine restarts rather than decorating today's
--    rows.
--
-- 2. A ROLLING WINDOW, SCOPED SO IT CANNOT TOUCH ACTION OR MADNESS. Until now
--    MAINTAIN judged EVERY hand of the sitting with a ten-hand minimum
--    (cumulative, Dan 2026-09-04). Dan's newer instruction is a rolling
--    thirty. The mode is carried per game in `ruleset_snapshot.vpip_rolling`,
--    written only for a matched Classic game, so an Action or Madness
--    snapshot has no such key, reads false, and judges exactly as it does
--    today - including its ten-hand window and the law that pins it
--    (tests/the-vpip-readers-share-the-evictions-window.law.test.ts).
--    fn_nit_sample is the ONE sample definition; all three readers and the
--    enforcement call it, so none of them can drift from another.
--
-- 3. WARN, THEN BOOT. ca_nit_warnings carries one open warning per sitting
--    (a partial unique index, so two concurrent boundaries cannot double-warn
--    or double-boot). Grace is counted in DEALT HANDS since the warning, not
--    wall clock, because the hand boundary is the only clock this path has.
--    Recovery at or above the floor clears the warning; a later lapse earns a
--    fresh full grace, never a shortened one. fn_nit_enforce is the live
--    transition the dealing loop calls at the boundary: it warns, it clears,
--    and it returns only the seats whose grace has run out. It is not a sweep,
--    a watcher or a repair job (CLAUDE.md 10.11, 10.12) - it is the rule
--    itself, running where the rule has always run.
--
-- WHY NO DAILY WINDOW. Nothing here takes ACCESS EXCLUSIVE on clubs, tables
-- or hand_history: no ALTER TABLE on public.tables (the policy rides in the
-- snapshot the propagators already read), two new relations, CREATE OR
-- REPLACE FUNCTION only, and one narrow UPDATE of the affected games taking
-- ordinary ROW EXCLUSIVE. ca_nit_warnings carries NO foreign key to a hot
-- relation (CLAUDE.md 2, rule 7). One transaction, one PostgREST reload
-- (rule 1).
--
-- THE FLOORS BELOW ARE CONFIG ROWS PENDING THE OWNER'S CONFIRMATION. Measured
-- over the three days to 2026-11-11, Classic by cash_games.template_name at
-- bb >= 1, players with 30+ dealt hands, tournaments excluded: nlh median
-- 17.1 (p25 15.5), plo4 27.3 (25.6), plo5 65.0 (64.1), plo6 64.8 (64.0), flh
-- 16.3 (13.6), flo8 25.3 (22.8); plo8, short_deck and pineapple had no player
-- reach thirty hands. NLH is Dan's 20% and is NOT lowered to suit the current
-- horse fleet. Each value is one UPDATE away, with no deploy.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- -- 1. The per-variant floors -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.ca_classic_vpip_floors (
  variant           text PRIMARY KEY,
  min_bb            numeric NOT NULL DEFAULT 1,
  floor_percent     integer NOT NULL,
  window_hands      integer NOT NULL DEFAULT 30,
  warn_grace_hands  integer NOT NULL DEFAULT 10,
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ca_classic_vpip_floors_floor_range  CHECK (floor_percent BETWEEN 0 AND 100),
  CONSTRAINT ca_classic_vpip_floors_window_sane  CHECK (window_hands >= 1),
  CONSTRAINT ca_classic_vpip_floors_grace_sane   CHECK (warn_grace_hands >= 0),
  CONSTRAINT ca_classic_vpip_floors_min_bb_sane  CHECK (min_bb > 0)
);

COMMENT ON TABLE public.ca_classic_vpip_floors IS
  'Per-variant VPIP floor for Classic cash games at or above min_bb (Dan 2026-11-10). '
  'Read by fn_cash_game_floor_from_template on every write to cash_games, which puts the '
  'floor into ruleset_snapshot, from where fn_cash_cluster_open_table and '
  'fn_cash_apply_ruleset carry it onto new and existing tables. Change a floor with an '
  'UPDATE; no deploy is needed.';

-- CLOSED BY DEFAULT. No player role has any business reading or writing the
-- floors: the only reader is fn_cash_game_floor_from_template, which runs as
-- the role writing cash_games, so service_role gets SELECT and nothing else.
-- The SECURITY DEFINER readers run as the owner and need no grant.
ALTER TABLE public.ca_classic_vpip_floors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_classic_vpip_floors FROM PUBLIC;
REVOKE ALL ON TABLE public.ca_classic_vpip_floors FROM anon;
REVOKE ALL ON TABLE public.ca_classic_vpip_floors FROM authenticated;
REVOKE ALL ON TABLE public.ca_classic_vpip_floors FROM service_role;
GRANT SELECT ON TABLE public.ca_classic_vpip_floors TO service_role;

INSERT INTO public.ca_classic_vpip_floors
  (variant, min_bb, floor_percent, window_hands, warn_grace_hands, note)
VALUES
  ('nlh',        1, 20, 30, 10, 'Owner value 2026-11-10. Field median 17.1, p25 15.5.'),
  ('plo4',       1, 30, 30, 10, 'Field median 27.3, p25 25.6. A 20 floor boots 4 of 122 and is inert.'),
  ('plo5',       1, 50, 30, 10, 'Already live at 50 via madness_without_lightning; field runs 65.0.'),
  ('plo6',       1, 50, 30, 10, 'Already live at 50 via madness_without_lightning; field runs 64.8.'),
  ('plo8',       1, 30, 30, 10, 'Same PLO family as plo4; no player reached 30 hands in the sample.'),
  ('flo8',       1, 25, 30, 10, 'Field median 25.3, p25 22.8. Fixed-limit Omaha hi-lo is played wide.'),
  ('flh',        1, 15, 30, 10, 'Field median 16.3, p25 13.6. Fixed-limit holdem is structurally tighter.'),
  ('short_deck', 1, 20, 30, 10, 'No player reached 30 hands in the sample; judgment, not evidence.'),
  ('pineapple',  1, 25, 30, 10, 'No player reached 30 hands in the sample; judgment, not evidence.')
ON CONFLICT (variant) DO NOTHING;

-- -- 2. The warning ledger ---------------------------------------------------
-- NO foreign key to tables or cash_games: an orphan row in a warning ledger is
-- harmless, a lock on a hot relation is not (CLAUDE.md 2, rule 7).
CREATE TABLE IF NOT EXISTS public.ca_nit_warnings (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  game_id        uuid,
  table_id       uuid NOT NULL,
  user_id        uuid NOT NULL,
  sitting_since  timestamptz,
  required       integer NOT NULL,
  vpip_at_warn   numeric,
  hands_at_warn  integer NOT NULL,
  grace_hands    integer NOT NULL,
  warned_at      timestamptz NOT NULL DEFAULT now(),
  cleared_at     timestamptz,
  cleared_reason text,
  CONSTRAINT ca_nit_warnings_reason_sane
    CHECK (cleared_reason IS NULL OR cleared_reason IN ('recovered','evicted','left','floor_off'))
);

-- One OPEN warning per sitting. This is what makes two concurrent hand
-- boundaries unable to warn twice or boot twice for the same lapse.
CREATE UNIQUE INDEX IF NOT EXISTS ca_nit_warnings_one_open_per_sitting
  ON public.ca_nit_warnings
     (coalesce(game_id, table_id), user_id, coalesce(sitting_since, '-infinity'::timestamptz))
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS ca_nit_warnings_open_by_table
  ON public.ca_nit_warnings (table_id) WHERE cleared_at IS NULL;

-- CLOSED BY DEFAULT, AND NOT EVEN service_role. Every reader and the only
-- writer (fn_nit_enforce, fn_nit_status, fn_cash_vpip_status) is SECURITY
-- DEFINER and runs as the owner, so the warning ledger needs no table grant to
-- anyone. A seat's warning is shown to its own player through
-- fn_cash_vpip_status and to the engine through fn_nit_status; nothing reads
-- the rows directly.
ALTER TABLE public.ca_nit_warnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_nit_warnings FROM PUBLIC;
REVOKE ALL ON TABLE public.ca_nit_warnings FROM anon;
REVOKE ALL ON TABLE public.ca_nit_warnings FROM authenticated;
REVOKE ALL ON TABLE public.ca_nit_warnings FROM service_role;
REVOKE ALL ON SEQUENCE public.ca_nit_warnings_id_seq FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.ca_nit_warnings IS
  'Open and historical VPIP warnings (Dan 2026-11-10: warn, then boot). Grace is counted in '
  'dealt hands after warned_at, never wall clock. One open row per sitting, enforced by a '
  'partial unique index so concurrent hand boundaries cannot double-warn or double-boot.';

-- -- 3. The policy a table is judged under -----------------------------------
-- ONE reader for on/floor/window/rolling/grace, so enforcement and every
-- display answer from the same row. An Action or Madness game has no
-- vpip_rolling key in its snapshot, so rolling is false and window falls back
-- to tables.maintain_hands - today's behaviour, untouched.
CREATE OR REPLACE FUNCTION public.fn_nit_policy(p_table_id uuid)
 RETURNS TABLE(nit_on boolean, floor_pct integer, window_hands integer,
               rolling boolean, grace_hands integer, game_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(t.nit_game, false),
         GREATEST(COALESCE(t.maintain_percent_min, 0), 0),
         GREATEST(
           COALESCE((g.ruleset_snapshot->>'vpip_window')::integer,
                    COALESCE(t.maintain_hands, 10)), 1),
         COALESCE((g.ruleset_snapshot->>'vpip_rolling')::boolean, false),
         GREATEST(COALESCE((g.ruleset_snapshot->>'vpip_grace_hands')::integer, 0), 0),
         t.cluster_id
    FROM public.tables t
    LEFT JOIN public.cash_games g ON g.id = t.cluster_id
   WHERE t.id = p_table_id
   LIMIT 1;
$function$;

-- -- 4. The one sample definition --------------------------------------------
-- Eligible hand = one ca_hand_facts row, i.e. one hand this player was DEALT
-- into, at or after the sitting began. Rolling takes the newest p_window of
-- them; cumulative takes all of them (LIMIT NULL). Forced blinds are not
-- voluntary and never set f.vpip, so neither mode can count one.
CREATE OR REPLACE FUNCTION public.fn_nit_sample(
  p_table_id uuid, p_game_id uuid, p_user_id uuid, p_since timestamptz,
  p_rolling boolean, p_window integer)
 RETURNS TABLE(hands integer, vpip numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT f.vpip AS v
      FROM public.ca_hand_facts f
     WHERE f.user_id = p_user_id
       AND (p_since IS NULL OR f.played_at >= p_since)
       AND (CASE WHEN p_game_id IS NOT NULL
                 THEN f.table_id IN (SELECT t2.id FROM public.tables t2
                                      WHERE t2.cluster_id = p_game_id)
                 ELSE f.table_id = p_table_id END)
     ORDER BY f.played_at DESC
     LIMIT CASE WHEN COALESCE(p_rolling, false) THEN GREATEST(p_window, 1) ELSE NULL END
  )
  SELECT count(*)::int,
         CASE WHEN count(*) = 0 THEN NULL
              ELSE round(100.0 * avg(CASE WHEN v THEN 1 ELSE 0 END), 1) END
    FROM eligible;
$function$;

-- Dealt hands a player has on file since an instant, in this game or at this
-- table. This is the grace clock: hands, not seconds.
CREATE OR REPLACE FUNCTION public.fn_nit_hands_since(
  p_table_id uuid, p_game_id uuid, p_user_id uuid, p_since timestamptz)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::int
    FROM public.ca_hand_facts f
   WHERE f.user_id = p_user_id
     AND (p_since IS NULL OR f.played_at > p_since)
     AND (CASE WHEN p_game_id IS NOT NULL
               THEN f.table_id IN (SELECT t2.id FROM public.tables t2
                                    WHERE t2.cluster_id = p_game_id)
               ELSE f.table_id = p_table_id END);
$function$;

-- -- 5. fn_nit_check, now on the shared policy and sample --------------------
-- The CAREER rule is unchanged in meaning: it still judges every hand on file
-- against career_percent_min above its own sample floor.
CREATE OR REPLACE FUNCTION public.fn_nit_check(p_table_id uuid, p_user_id uuid,
                                               p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pol           record;
  v_career_min    integer;
  v_since         timestamptz;
  v_career_floor  integer;
  v_career_hands  integer;
  v_career_vpip   numeric;
  v_table_hands   integer;
  v_table_vpip    numeric;
BEGIN
  SELECT * INTO v_pol FROM public.fn_nit_policy(p_table_id);
  IF v_pol.nit_on IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'table_not_found');
  END IF;

  SELECT GREATEST(COALESCE(t.career_percent_min, 0), 0) INTO v_career_min
    FROM public.tables t WHERE t.id = p_table_id LIMIT 1;

  -- The toggle is the master switch. With NIT Game off the numbers do nothing,
  -- which is what a switch labelled "Penalty for tight play" means.
  IF NOT COALESCE(v_pol.nit_on, false) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'nit_game_off');
  END IF;

  -- CAREER
  IF v_career_min > 0 THEN
    v_career_floor := GREATEST(v_pol.window_hands * 10, 100);
    SELECT count(*)::int,
           CASE WHEN count(*) = 0 THEN NULL
                ELSE round(100.0 * avg(CASE WHEN f.vpip THEN 1 ELSE 0 END), 1) END
      INTO v_career_hands, v_career_vpip
      FROM public.ca_hand_facts f
     WHERE f.user_id = p_user_id;

    IF v_career_hands >= v_career_floor AND v_career_vpip < v_career_min THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'career_vpip',
        'vpip', v_career_vpip, 'required', v_career_min, 'hands', v_career_hands);
    END IF;
  END IF;

  -- MAINTAIN
  -- THE SITTING IN THE GAME, NOT THE CHAIR (2026-09-09): on a cluster table
  -- the sample is every fact row on any table of the game since the roster
  -- row's joined_at, so a must-move does not restart the window and neither
  -- does a reconnect or an engine restart. A genuine leave closes the roster
  -- row and does start a fresh count. fn_nit_sitting_since is the one window
  -- definition the readers share (2026-10-24), and it never reaches back
  -- before the instant the floor was turned on.
  IF v_pol.floor_pct > 0 THEN
    v_since := p_since;
    IF v_pol.game_id IS NOT NULL THEN
      v_since := public.fn_nit_sitting_since(v_pol.game_id, p_user_id, p_since);
    END IF;

    SELECT s.hands, s.vpip INTO v_table_hands, v_table_vpip
      FROM public.fn_nit_sample(p_table_id, v_pol.game_id, p_user_id, v_since,
                                v_pol.rolling, v_pol.window_hands) s;

    IF v_table_hands >= v_pol.window_hands AND v_table_vpip < v_pol.floor_pct THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'maintain_vpip',
        'vpip', v_table_vpip, 'required', v_pol.floor_pct, 'hands', v_table_hands,
        'rolling', v_pol.rolling, 'window', v_pol.window_hands,
        'grace_hands', v_pol.grace_hands);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'within_limits');
END;
$function$;

-- -- 6. fn_nit_status: every seat's judged figure, plus its warning ----------
-- fn_nit_status GAINS COLUMNS (rolling, warned, grace_hands, grace_remaining),
-- and Postgres refuses CREATE OR REPLACE on a changed return type for a
-- set-returning function. It is dropped and recreated inside this one
-- transaction. A DROP takes the ACL with it, so the grants are restored
-- immediately below, byte for byte as production held them
-- (postgres=X, service_role=X; never anon or authenticated - the engine is
-- the only caller, and a seat's figure is private to its own player, which is
-- what fn_cash_vpip_status is for).
DROP FUNCTION IF EXISTS public.fn_nit_status(uuid);

CREATE OR REPLACE FUNCTION public.fn_nit_status(p_table_id uuid)
 RETURNS TABLE(user_id uuid, hands integer, vpip numeric, required integer,
               window_hands integer, evict boolean, rolling boolean,
               warned boolean, grace_hands integer, grace_remaining integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pol      record;
  v_since    timestamptz;
  v_warn_at  timestamptz;
  v_warn_gr  integer;
  r          record;
BEGIN
  SELECT * INTO v_pol FROM public.fn_nit_policy(p_table_id);
  IF v_pol.nit_on IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT ts.user_id AS uid, ts.joined_at
      FROM public.table_seats ts
     WHERE ts.table_id = p_table_id
       AND ts.left_at IS NULL
  LOOP
    v_since := r.joined_at;
    IF v_pol.game_id IS NOT NULL THEN
      v_since := public.fn_nit_sitting_since(v_pol.game_id, r.uid, r.joined_at);
    END IF;

    SELECT s.hands, s.vpip INTO hands, vpip
      FROM public.fn_nit_sample(p_table_id, v_pol.game_id, r.uid, v_since,
                                v_pol.rolling, v_pol.window_hands) s;

    v_warn_at := NULL; v_warn_gr := NULL;
    SELECT w.warned_at, w.grace_hands INTO v_warn_at, v_warn_gr
      FROM public.ca_nit_warnings w
     WHERE coalesce(w.game_id, w.table_id) = coalesce(v_pol.game_id, p_table_id)
       AND w.user_id = r.uid
       AND w.cleared_at IS NULL
     LIMIT 1;

    user_id      := r.uid;
    required     := CASE WHEN v_pol.nit_on THEN v_pol.floor_pct ELSE 0 END;
    window_hands := v_pol.window_hands;
    rolling      := v_pol.rolling;
    grace_hands  := v_pol.grace_hands;
    warned       := v_warn_at IS NOT NULL;
    grace_remaining := CASE
      WHEN v_warn_at IS NULL THEN NULL
      ELSE GREATEST(v_warn_gr
             - public.fn_nit_hands_since(p_table_id, v_pol.game_id, r.uid, v_warn_at), 0)
      END;
    -- `evict` stays the UNDER-THE-FLOOR verdict the brain and the HUD have
    -- always read. Whether that verdict costs the seat now is grace_remaining.
    evict := v_pol.nit_on AND v_pol.floor_pct > 0
             AND hands >= v_pol.window_hands AND vpip IS NOT NULL
             AND vpip < v_pol.floor_pct;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_nit_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nit_status(uuid) TO service_role;

-- -- 7. fn_cash_vpip_status: the hero's own tracker, with the warning --------
CREATE OR REPLACE FUNCTION public.fn_cash_vpip_status(p_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_pol     record;
  v_joined  timestamptz;
  v_since   timestamptz;
  v_hands   integer;
  v_vpip    numeric;
  v_warn_at timestamptz;
  v_warn_gr integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  SELECT * INTO v_pol FROM public.fn_nit_policy(p_table_id);
  IF v_pol.nit_on IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_not_found');
  END IF;

  SELECT ts.joined_at INTO v_joined
    FROM public.table_seats ts
   WHERE ts.table_id = p_table_id AND ts.user_id = v_uid AND ts.left_at IS NULL
   ORDER BY ts.joined_at DESC NULLS LAST
   LIMIT 1;
  IF v_joined IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'seated', false,
      'nit_game', v_pol.nit_on,
      'required', CASE WHEN v_pol.nit_on THEN v_pol.floor_pct ELSE 0 END,
      'window', v_pol.window_hands, 'rolling', v_pol.rolling);
  END IF;

  v_since := v_joined;
  IF v_pol.game_id IS NOT NULL THEN
    v_since := public.fn_nit_sitting_since(v_pol.game_id, v_uid, v_joined);
  END IF;

  SELECT s.hands, s.vpip INTO v_hands, v_vpip
    FROM public.fn_nit_sample(p_table_id, v_pol.game_id, v_uid, v_since,
                              v_pol.rolling, v_pol.window_hands) s;

  SELECT w.warned_at, w.grace_hands INTO v_warn_at, v_warn_gr
    FROM public.ca_nit_warnings w
   WHERE coalesce(w.game_id, w.table_id) = coalesce(v_pol.game_id, p_table_id)
     AND w.user_id = v_uid
     AND w.cleared_at IS NULL
   LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true, 'seated', true,
    'nit_game', v_pol.nit_on,
    'required', CASE WHEN v_pol.nit_on THEN v_pol.floor_pct ELSE 0 END,
    'window', v_pol.window_hands,
    'rolling', v_pol.rolling,
    'hands', v_hands,
    'vpip', v_vpip,
    'since', v_since,
    'warned', v_warn_at IS NOT NULL,
    'grace_hands', v_pol.grace_hands,
    'grace_remaining', CASE
      WHEN v_warn_at IS NULL THEN NULL
      ELSE GREATEST(v_warn_gr
             - public.fn_nit_hands_since(p_table_id, v_pol.game_id, v_uid, v_warn_at), 0)
      END);
END;
$function$;

-- -- 8. fn_nit_evictions stays the pure read ---------------------------------
-- Unchanged in contract: every seat whose MAINTAIN verdict is under the floor
-- right now, ignoring grace. The dealing loop no longer calls it; readers and
-- proofs still do, and it is what fn_nit_enforce returns where grace is 0.
CREATE OR REPLACE FUNCTION public.fn_nit_evictions(p_table_id uuid)
 RETURNS TABLE(user_id uuid, vpip numeric, required integer, hands integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v jsonb;
BEGIN
  FOR r IN
    SELECT ts.user_id AS uid, ts.joined_at
      FROM public.table_seats ts
      JOIN public.profiles p ON p.id = ts.user_id
     WHERE ts.table_id = p_table_id
       AND ts.left_at IS NULL
       -- HORSES ARE PLAYERS (Dan 2026-08-27). No horse predicate here, ever.
  LOOP
    v := public.fn_nit_check(p_table_id, r.uid, r.joined_at);
    IF (v->>'ok')::boolean = false AND v->>'reason' = 'maintain_vpip' THEN
      user_id  := r.uid;
      vpip     := (v->>'vpip')::numeric;
      required := (v->>'required')::integer;
      hands    := (v->>'hands')::integer;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- -- 9. fn_nit_enforce: warn, clear, then boot -------------------------------
-- The live transition, called by the dealing loop at a hand boundary. It is
-- the rule, not a net: nothing here repairs a past outcome (CLAUDE.md 10.11,
-- 10.12).
--
-- With grace_hands = 0 (Action, Madness, and any floored table outside a
-- Classic game) it returns exactly what fn_nit_evictions returns, so those
-- templates keep booting on the spot as they do today.
CREATE OR REPLACE FUNCTION public.fn_nit_enforce(p_table_id uuid)
 RETURNS TABLE(user_id uuid, vpip numeric, required integer, hands integer,
               warned boolean, grace_remaining integer)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pol     record;
  v_key     uuid;
  r         record;
  v         jsonb;
  v_under   boolean;
  v_warn_id bigint;
  v_warn_at timestamptz;
  v_warn_gr integer;
  v_since   timestamptz;
  v_done    integer;
BEGIN
  SELECT * INTO v_pol FROM public.fn_nit_policy(p_table_id);
  IF v_pol.nit_on IS NULL OR NOT COALESCE(v_pol.nit_on, false) OR v_pol.floor_pct <= 0 THEN
    -- The floor is off. Any warning it left behind is retired, not held over.
    UPDATE public.ca_nit_warnings w
       SET cleared_at = now(), cleared_reason = 'floor_off'
     WHERE w.table_id = p_table_id AND w.cleared_at IS NULL;
    RETURN;
  END IF;

  v_key := coalesce(v_pol.game_id, p_table_id);

  FOR r IN
    SELECT ts.user_id AS uid, ts.joined_at
      FROM public.table_seats ts
      JOIN public.profiles p ON p.id = ts.user_id
     WHERE ts.table_id = p_table_id
       AND ts.left_at IS NULL
       -- HORSES ARE PLAYERS (Dan 2026-08-27). Humans and horses, one rule.
  LOOP
    v := public.fn_nit_check(p_table_id, r.uid, r.joined_at);
    v_under := (v->>'ok')::boolean = false AND v->>'reason' = 'maintain_vpip';

    v_warn_id := NULL; v_warn_at := NULL; v_warn_gr := NULL;
    SELECT w.id, w.warned_at, w.grace_hands INTO v_warn_id, v_warn_at, v_warn_gr
      FROM public.ca_nit_warnings w
     WHERE coalesce(w.game_id, w.table_id) = v_key
       AND w.user_id = r.uid
       AND w.cleared_at IS NULL
     LIMIT 1;

    IF NOT v_under THEN
      -- RECOVERY. At or above the floor at this boundary clears the warning.
      -- A later lapse earns a fresh, full grace - never a shortened one.
      IF v_warn_id IS NOT NULL THEN
        UPDATE public.ca_nit_warnings
           SET cleared_at = now(), cleared_reason = 'recovered'
         WHERE id = v_warn_id AND cleared_at IS NULL;
      END IF;
      CONTINUE;
    END IF;

    -- Under the floor, with the sample minimum already met: fn_nit_check does
    -- not say maintain_vpip below window_hands.
    IF v_pol.grace_hands <= 0 THEN
      user_id := r.uid; vpip := (v->>'vpip')::numeric;
      required := (v->>'required')::integer; hands := (v->>'hands')::integer;
      warned := false; grace_remaining := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_warn_id IS NULL THEN
      -- FIRST LAPSE: warn, do not boot. The partial unique index is what makes
      -- two concurrent boundaries unable to open a second warning.
      v_since := r.joined_at;
      IF v_pol.game_id IS NOT NULL THEN
        v_since := public.fn_nit_sitting_since(v_pol.game_id, r.uid, r.joined_at);
      END IF;
      INSERT INTO public.ca_nit_warnings
        (game_id, table_id, user_id, sitting_since, required, vpip_at_warn,
         hands_at_warn, grace_hands)
      VALUES
        (v_pol.game_id, p_table_id, r.uid, v_since, v_pol.floor_pct,
         (v->>'vpip')::numeric, (v->>'hands')::integer, v_pol.grace_hands)
      ON CONFLICT DO NOTHING;
      -- A warning costs no seat, so nothing is returned for it.
      CONTINUE;
    END IF;

    -- A warning is open. Grace is spent in DEALT HANDS since it was issued.
    v_done := public.fn_nit_hands_since(p_table_id, v_pol.game_id, r.uid, v_warn_at);
    IF v_done < v_warn_gr THEN
      CONTINUE;  -- still inside grace, still their seat
    END IF;

    -- Grace spent and still under the floor: this seat is now evictable. The
    -- caller stands it up at the hand boundary through atomicCashout; the row
    -- is closed here, and the UPDATE's own row count is what stops a second
    -- concurrent boundary booting the same lapse twice.
    UPDATE public.ca_nit_warnings
       SET cleared_at = now(), cleared_reason = 'evicted'
     WHERE id = v_warn_id AND cleared_at IS NULL;
    IF NOT FOUND THEN
      CONTINUE;  -- another boundary took it first
    END IF;

    user_id := r.uid; vpip := (v->>'vpip')::numeric;
    required := (v->>'required')::integer; hands := (v->>'hands')::integer;
    warned := true; grace_remaining := 0;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_nit_enforce(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nit_enforce(uuid) TO service_role;

-- -- 10. The template writes the Classic floor on every game write ----------
-- This is the one insertion point. fn_cash_cluster_open_table (new tables) and
-- fn_cash_apply_ruleset (existing tables) both derive nit_game,
-- maintain_percent_min and maintain_hands from this snapshot, so a floor
-- written here reaches every table the game will ever open.
CREATE OR REPLACE FUNCTION public.fn_cash_game_floor_from_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_def   jsonb;
  v_floor integer;
  v_win   integer;
  v_grace integer;
BEGIN
  IF NEW.ruleset_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE TEMPLATE IS A PROMISE TO THE PLAYER (2026-09-09).
  v_def := public.fn_cash_template_defaults(NEW.template_name, NEW.variant);

  -- MADNESS WITHOUT LIGHTNING (Dan 2026-10-24).
  IF NEW.template_name = 'classic'
     AND NOT coalesce(NEW.lightning_enabled, false)
     AND NEW.variant NOT IN ('pineapple', 'pineapple_holdem')
     AND NEW.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning' THEN
    v_def := public.fn_cash_template_defaults('madness', NEW.variant)
             || jsonb_build_object('vpip_floor', 50);
  END IF;

  NEW.ruleset_snapshot := NEW.ruleset_snapshot
    || jsonb_build_object(
         'vpip_floor',   v_def->'vpip_floor',
         'vpip_window',  v_def->'vpip_window',
         'regular_ante', v_def->'regular_ante',
         'bombs',        v_def->'bombs',
         'min_buyin_bb', v_def->'min_buyin_bb');

  -- THE CLASSIC FLOOR (Dan 2026-11-10). A Classic cash game at or above the
  -- configured minimum big blind carries its variant's floor, a rolling
  -- window and a warning grace. GREATEST so an existing stronger floor - the
  -- 50% madness_without_lightning puts on plo5 and plo6 - is preserved rather
  -- than lowered by a config row. A tournament table never reaches here:
  -- cash_games holds cash clusters only.
  IF NEW.template_name = 'classic' THEN
    SELECT fl.floor_percent, fl.window_hands, fl.warn_grace_hands
      INTO v_floor, v_win, v_grace
      FROM public.ca_classic_vpip_floors fl
     WHERE fl.variant = NEW.variant
       AND NEW.bb >= fl.min_bb
     LIMIT 1;

    IF v_floor IS NOT NULL THEN
      NEW.ruleset_snapshot := NEW.ruleset_snapshot
        || jsonb_build_object(
             'vpip_floor', GREATEST(
                             COALESCE((NEW.ruleset_snapshot->>'vpip_floor')::integer, 0),
                             v_floor),
             'vpip_window',      v_win,
             'vpip_rolling',     true,
             'vpip_grace_hands', v_grace);

      -- The floor never reaches back over hands played before it existed.
      IF (NEW.ruleset_snapshot->>'vpip_floor_since') IS NULL THEN
        NEW.ruleset_snapshot := NEW.ruleset_snapshot
          || jsonb_build_object('vpip_floor_since', to_jsonb(now()));
      END IF;
    END IF;
  END IF;

  IF NEW.variant IN ('flh','flo8') THEN
    NEW.ruleset_snapshot := NEW.ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL);
  END IF;
  RETURN NEW;
END;
$function$;

-- -- 11. Authorization, written down for every function this re-declares ----
-- CREATE OR REPLACE preserves an existing ACL, so production's grants would
-- have survived untouched. But a migration that re-declares a SECURITY DEFINER
-- function and says nothing about who may call it reads as "default PUBLIC
-- EXECUTE" to the definer-authorization gate, and the gate is right to refuse
-- that: a definer function runs past RLS as the owner, and read-only is not
-- the same as harmless. These are exactly the grants production already holds
-- (measured 2026-11-11), now stated instead of inherited. PUBLIC is named
-- alongside the roles because anon inherits whatever PUBLIC holds, so revoking
-- anon alone reads as a fix and does nothing. None of these backs an RLS
-- policy expression (checked against pg_policy).

-- ENGINE AND OPERATOR ONLY (production: postgres=X, service_role=X).
REVOKE ALL ON FUNCTION public.fn_nit_evictions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nit_evictions(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_nit_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nit_status(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_nit_enforce(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nit_enforce(uuid) TO service_role;

-- The three helpers are not SECURITY DEFINER, but each takes any user id, so
-- they are engine-side as well. The definer readers call them as the owner and
-- need no grant of their own.
REVOKE ALL ON FUNCTION public.fn_nit_policy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nit_policy(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_nit_sample(uuid, uuid, uuid, timestamptz, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nit_sample(uuid, uuid, uuid, timestamptz, boolean, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.fn_nit_hands_since(uuid, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nit_hands_since(uuid, uuid, uuid, timestamptz)
  TO service_role;

-- A LOGGED-IN PLAYER, NEVER A PRE-LOGIN CALLER (production: postgres=X,
-- authenticated=X, service_role=X). fn_cash_vpip_status is keyed on auth.uid()
-- by construction, so it is private to its own caller; fn_nit_check is the
-- verdict behind the tracker that shows it.
REVOKE ALL ON FUNCTION public.fn_nit_check(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nit_check(uuid, uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_cash_vpip_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_vpip_status(uuid) TO authenticated, service_role;

COMMIT;
