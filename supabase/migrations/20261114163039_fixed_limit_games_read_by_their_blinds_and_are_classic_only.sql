-- 20261114163039_fixed_limit_games_read_by_their_blinds_and_are_classic_only.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- OWNER RULING, NOVEMBER 14, 2026 (Dan, from the lobby, on the "FLH 2/4" and
-- "FLH 1/2" cards):
--   "FORCED LIMIT GAMES CAN HAVE HIGHER STAKES. THOSE GAMES CAN GO UP AS HIGH
--    AS 5/10. ... IT SHOULD BE DISPLAYED AS 'FIXED LIMIT 1/2' AND FOR OMAHA
--    GAMES IT SHOULD SAY 'OMAHA 4 CARD FIXED LIMIT' OMAHA 5 CARD FIXED LIMIT
--    OMAHA 6 CARD FIXED LIMIT, OMAHA 8o FIXED LIMIT. GAME LIMITS SHOULD BE
--    .25/.50 .50/1.00 1/2 2/5 AND 5/10 ... AND THEY ARE ALL ALWAYS CLASSIC
--    GAME SET UP."
-- and, the same morning, on the titles: "they need to say Fixed Limit Holdem
-- (spelt out) not abbreviated."
--
-- 1. STAKES READ AS BLINDS. fn_cash_stakes_label printed a fixed-limit game by
--    its BET sizes (blinds 1/2 read "2/4"), so the 2/5 and 5/10 blind games
--    named themselves "5/10" and "10/20" and looked above the 5/10 ceiling the
--    stake guard actually holds them to. Every game now reads by its blinds,
--    as the client's stakesLabel does from the same release. The bets are
--    unchanged: the engine sizes them from the big blind.
--
-- 2. THE NAMES. Games are named "Fixed Limit Holdem 1/2 Classic" and
--    "Omaha 8o Fixed Limit 1/2 Classic" (and Omaha 4 / 5 / 6 Card Fixed Limit,
--    which the engine deals from its next certified release; until then the
--    creator's variant list still refuses them). fn_cash_game_ensure and the
--    creator spell them that way from now on, and the existing generated names
--    ("FLH 2/4 Classic") of every open limit game and table are rewritten to
--    the new words with their blinds. A name a host typed is not touched.
--
-- 3. CLASSIC ONLY. The creator refuses an Action, Madness or Lightning limit
--    game (LIGHTNING_VARIANT_NOT_ALLOWED, which the client already reads), the
--    machine owner fn_cash_game_ensure resolves any limit order to Classic, and
--    fn_lightning_variant_allowed names every limit game. The existing
--    non-Classic limit games are switched off the owner's way (enabled =
--    false: no seeding, no opening, every seated player keeps playing and
--    leaves through the ordinary cash-out, each table closes once empty).
--    The one limit game whose Lightning switch is on (its cluster in
--    must_move, nothing in Lightning) has the switch cleared the way the
--    operator door's disable_lightning clears it.
--
-- 4. THE LADDER. Every rung Dan named already exists as a Classic game for
--    both limit variants on the host that runs limit (Midway Union): 0.25/0.50,
--    0.50/1, 1/2, 2/5, 5/10. The one rung below his ladder, 0.10/0.25, is
--    switched off the same way. The 5/10 cap (fn_cash_game_max_stake_guard) is
--    unchanged.
--
-- No wallet, seat, stack, ledger or settled hand is written. Retired clubs are
-- untouched (each statement is scoped to non-retired owners). Each preimage is
-- checked before its patch, so a function that moved underneath this file
-- refuses the whole transaction instead of being half rewritten.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- ── 1. Stakes read as blinds, for every game ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cash_stakes_label(p_sb numeric, p_bb numeric, p_variant text DEFAULT 'nlh'::text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Owner ruling, November 14, 2026: fixed limit reads by its blinds too
  -- ("FIXED LIMIT 1/2"). p_variant is kept so every caller stays as it is.
  SELECT public.fn_cash_money_text(p_sb) || '/' || public.fn_cash_money_text(p_bb);
$function$;

-- ── 2 and 3. The names, and Classic only, in the two owners that name games ──
DO $patch$
DECLARE
  src text;
  old_labels constant text := $n$WHEN 'plo8' THEN 'PLO8' WHEN 'flo8' THEN 'FLO8' WHEN 'flh' THEN 'FLH'$n$;
  new_labels constant text := $r$WHEN 'plo8' THEN 'PLO8' WHEN 'flo8' THEN 'Omaha 8o Fixed Limit' WHEN 'flh' THEN 'Fixed Limit Holdem'
    WHEN 'flo4' THEN 'Omaha 4 Card Fixed Limit' WHEN 'flo5' THEN 'Omaha 5 Card Fixed Limit'
    WHEN 'flo6' THEN 'Omaha 6 Card Fixed Limit'$r$;
  needle text;
BEGIN
  -- The creator: name the game, and refuse any template but Classic for limit.
  src := pg_get_functiondef('public.fn_cash_game_create_impl_20260905(uuid,text,text,numeric,numeric,integer,jsonb,text,boolean)'::regprocedure);
  IF strpos(src, old_labels) = 0 THEN
    RAISE EXCEPTION 'Fixed-limit naming preimage changed in fn_cash_game_create_impl_20260905';
  END IF;
  src := replace(src, old_labels, new_labels);
  needle := $n$  IF v_v NOT IN ('nlh','plo4','plo5','plo6','plo8','flo8','flh','short_deck','pineapple') THEN
    RAISE EXCEPTION 'VARIANT_UNAVAILABLE: % is not available yet', p_variant;
  END IF;$n$;
  IF strpos(src, needle) = 0 THEN
    RAISE EXCEPTION 'Variant gate preimage changed in fn_cash_game_create_impl_20260905';
  END IF;
  src := replace(src, needle, needle || $r$
  -- Owner ruling, November 14, 2026: "THEY ARE ALL ALWAYS CLASSIC GAME SET UP".
  IF v_v IN ('flh','flo4','flo5','flo6','flo8') AND v_t <> 'classic' THEN
    RAISE EXCEPTION 'LIGHTNING_VARIANT_NOT_ALLOWED: Fixed Limit Games Are Classic Games'
      USING ERRCODE = '22023';
  END IF;$r$);
  EXECUTE src;

  -- The machine owner: name the game, and resolve any limit order to Classic.
  src := pg_get_functiondef('public.fn_cash_game_ensure(uuid,text,numeric,numeric,text,integer)'::regprocedure);
  IF strpos(src, old_labels) = 0 THEN
    RAISE EXCEPTION 'Fixed-limit naming preimage changed in fn_cash_game_ensure';
  END IF;
  src := replace(src, old_labels, new_labels);
  needle := $n$  IF v_t NOT IN ('classic', 'action', 'madness') THEN v_t := 'classic'; END IF;$n$;
  IF strpos(src, needle) = 0 THEN
    RAISE EXCEPTION 'Template preimage changed in fn_cash_game_ensure';
  END IF;
  src := replace(src, needle, needle || $r$
  -- Owner ruling, November 14, 2026: every limit game is a Classic game.
  IF v_v IN ('flh','flo4','flo5','flo6','flo8') THEN v_t := 'classic'; END IF;$r$);
  EXECUTE src;
END
$patch$;

-- ── 3. No limit game runs Lightning ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lightning_variant_allowed(p_variant text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$ SELECT coalesce(lower(p_variant) NOT IN
  ('short_deck','shortdeck','flo8','plo8','omaha8','o8','pineapple','pineapple_holdem',
   -- Owner ruling, November 14, 2026: every limit game is Classic.
   'flh','flo4','flo5','flo6'), false) $function$;

-- ── 3 and 4. Switch off every limit game that is not a Classic rung ─────────
-- The owner's switch (fn_cash_game_switch_off) sets exactly this; its door
-- needs an authenticated operator, so the ruling is applied here and recorded
-- on each game's own event log.
--
-- cash_games_lightning_variant_allowed now refuses Lightning for Fixed Limit
-- Holdem as well, so a limit game whose Lightning switch is on would refuse
-- every later write, the switch-off included. Measured before this file: one
-- such game, Midway's "FLH 0.25/0.50 Lightning Games" (Madness), with the
-- switch on and its cluster in must_move, so nothing is in Lightning. Its
-- switch is cleared exactly as the operator door's disable_lightning clears a
-- must-move cluster (lightning_enabled false, lightning_off_condition_since
-- NULL). A limit cluster that IS in Lightning (pending_on or lightning) has
-- hands to finish first, so the whole file refuses and nothing is written.
DO $lightning$
DECLARE v_id uuid;
BEGIN
  SELECT g.id INTO v_id FROM public.cash_games g
   WHERE g.variant IN ('flh','flo4','flo5','flo6','flo8')
     AND g.cluster_mode IN ('pending_on','lightning')
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'fixed limit game % is in Lightning; drain it through fn_lightning_operator_control before this ruling installs', v_id;
  END IF;
END
$lightning$;

WITH before AS (
  SELECT g.id, coalesce(g.lightning_enabled, false) AS was_lightning
    FROM public.cash_games g
   WHERE g.enabled
     AND g.variant IN ('flh','flo4','flo5','flo6','flo8')
     AND (g.template_name <> 'classic'
          OR (g.sb, g.bb) NOT IN ((0.25, 0.50), (0.50, 1.00), (1.00, 2.00), (2.00, 5.00), (5.00, 10.00)))
     AND EXISTS (SELECT 1 FROM public.clubs c
                  WHERE c.id = g.club_id AND c.lifecycle_status IS DISTINCT FROM 'retired')
     FOR UPDATE OF g
), off AS (
  UPDATE public.cash_games g
     SET enabled = false,
         lightning_enabled = false,
         lightning_off_condition_since = CASE WHEN b.was_lightning THEN NULL
                                              ELSE g.lightning_off_condition_since END,
         updated_at = now()
    FROM before b
   WHERE g.id = b.id
  RETURNING g.id, g.template_name, g.sb, g.bb, b.was_lightning
)
INSERT INTO public.cash_cluster_events (game_id, kind, payload)
SELECT off.id, 'game_switched_off_by_owner',
       jsonb_build_object(
         'reason', CASE WHEN off.template_name <> 'classic'
                        THEN 'Owner ruling 2026-11-14: every fixed limit game is a Classic game'
                        ELSE 'Owner ruling 2026-11-14: fixed limit stakes are .25/.50 .50/1.00 1/2 2/5 and 5/10' END,
         'by', '20261114163039_fixed_limit_games_read_by_their_blinds_and_are_classic_only',
         'template', off.template_name, 'sb', off.sb, 'bb', off.bb,
         'lightning_switch_cleared', off.was_lightning)
  FROM off;

-- ── 2. Rename the generated names of every open limit game and its tables ───
-- Only a name the platform generated ("FLH 2/4 Classic", "FLO8 0.50/1
-- Classic") is rewritten, to "<name> <blinds> Classic". Each open table of the
-- game keeps whatever followed the game's name (" Feeder", " Main 2"). A
-- table row a hand is holding is skipped rather than waited on; it keeps its
-- old name until it closes, and every table opened from now on is named new.
DO $rename$
DECLARE
  g record;
  t record;
  v_new text;
  v_label text;
BEGIN
  FOR g IN
    SELECT cg.id, cg.name, cg.variant, cg.sb, cg.bb, cg.template_name
      FROM public.cash_games cg
     WHERE cg.enabled AND cg.closed_at IS NULL
       AND cg.variant IN ('flh','flo8')
       AND cg.name ~ '^(FLH|FLO8) [0-9.]+/[0-9.]+ (Classic|Action|Madness)$'
       AND EXISTS (SELECT 1 FROM public.clubs c
                    WHERE c.id = cg.club_id AND c.lifecycle_status IS DISTINCT FROM 'retired')
  LOOP
    v_label := CASE g.variant WHEN 'flh' THEN 'Fixed Limit Holdem' ELSE 'Omaha 8o Fixed Limit' END;
    v_new := left(v_label || ' ' || public.fn_cash_stakes_label(g.sb, g.bb, g.variant)
                  || ' ' || initcap(g.template_name), 60);
    UPDATE public.cash_games SET name = v_new, updated_at = now() WHERE id = g.id;
    FOR t IN
      SELECT tb.id, tb.name FROM public.tables tb
       WHERE tb.cluster_id = g.id AND tb.lifecycle <> 'closed'
         AND NOT coalesce(tb.is_deleted, false)
         AND left(tb.name, length(g.name)) = g.name
    LOOP
      BEGIN
        UPDATE public.tables
           SET name = left(v_new || substr(t.name, length(g.name) + 1), 60)
         WHERE id = t.id;
      EXCEPTION WHEN lock_not_available THEN
        RAISE NOTICE 'table % held by a hand; it keeps its name until it closes', t.id;
      END;
    END LOOP;
  END LOOP;
END
$rename$;

-- ── 1. Every open limit table's stakes column reads its blinds ──────────────
DO $stakes$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tb.id, tb.small_blind, tb.big_blind, tb.game_variant FROM public.tables tb
     WHERE tb.tournament_id IS NULL
       AND tb.game_variant IN ('flh','flo8')
       AND tb.lifecycle <> 'closed' AND NOT coalesce(tb.is_deleted, false)
       AND tb.stakes IS DISTINCT FROM public.fn_cash_stakes_label(tb.small_blind, tb.big_blind, tb.game_variant)
       AND EXISTS (SELECT 1 FROM public.clubs c
                    WHERE c.id = tb.club_id AND c.lifecycle_status IS DISTINCT FROM 'retired')
  LOOP
    BEGIN
      UPDATE public.tables
         SET stakes = public.fn_cash_stakes_label(t.small_blind, t.big_blind, t.game_variant)
       WHERE id = t.id;
    EXCEPTION WHEN lock_not_available THEN
      RAISE NOTICE 'table % held by a hand; its stakes text follows on its next ruleset write', t.id;
    END;
  END LOOP;
END
$stakes$;

-- ── Proof, inside the transaction ────────────────────────────────────────────
DO $proof$
BEGIN
  IF public.fn_cash_stakes_label(1, 2, 'flh') <> '1/2'
     OR public.fn_cash_stakes_label(0.25, 0.50, 'flo8') <> '0.25/0.50'
     OR public.fn_cash_stakes_label(5, 10, 'flh') <> '5/10'
     OR public.fn_cash_stakes_label(1, 2, 'nlh') <> '1/2' THEN
    RAISE EXCEPTION 'fn_cash_stakes_label does not read blinds';
  END IF;
  IF public.fn_lightning_variant_allowed('flh') OR public.fn_lightning_variant_allowed('flo4')
     OR NOT public.fn_lightning_variant_allowed('nlh') THEN
    RAISE EXCEPTION 'fn_lightning_variant_allowed does not refuse fixed limit';
  END IF;
  IF strpos(pg_get_functiondef('public.fn_cash_game_ensure(uuid,text,numeric,numeric,text,integer)'::regprocedure),
            'Omaha 8o Fixed Limit') = 0
     OR strpos(pg_get_functiondef('public.fn_cash_game_ensure(uuid,text,numeric,numeric,text,integer)'::regprocedure),
            '''Fixed Limit Holdem''') = 0
     OR strpos(pg_get_functiondef('public.fn_cash_game_create_impl_20260905(uuid,text,text,numeric,numeric,integer,jsonb,text,boolean)'::regprocedure),
            '''Fixed Limit Holdem''') = 0 THEN
    RAISE EXCEPTION 'fn_cash_game_ensure does not name fixed limit games';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_games g
              WHERE g.enabled AND g.variant IN ('flh','flo4','flo5','flo6','flo8')
                AND g.template_name <> 'classic'
                AND EXISTS (SELECT 1 FROM public.clubs c
                             WHERE c.id = g.club_id AND c.lifecycle_status IS DISTINCT FROM 'retired')) THEN
    RAISE EXCEPTION 'a non-Classic fixed limit game is still enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_games g
              WHERE g.variant IN ('flh','flo4','flo5','flo6','flo8')
                AND NOT public.fn_lightning_variant_allowed(g.variant)
                AND (coalesce(g.lightning_enabled, false) OR g.cluster_mode IN ('pending_on','lightning'))
                AND EXISTS (SELECT 1 FROM public.clubs c
                             WHERE c.id = g.club_id AND c.lifecycle_status IS DISTINCT FROM 'retired')) THEN
    RAISE EXCEPTION 'a fixed limit game still has its Lightning switch on';
  END IF;
END
$proof$;

COMMIT;
