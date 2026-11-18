-- 20261115161427_tournament_share_preview_for_a_signed_out_link.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-15, share-link improvements):
--
-- A shared hand draws its own preview card in a chat app
-- (smarter.poker/h/<token>, migration 20261107021555). A shared TOURNAMENT
-- drew the generic Poker Arena card and, opened signed out, a bare sign-in
-- page: nobody receiving it could see what they were being invited to. The
-- World Hub's new smarter.poker/t/<id> page and its preview image read the
-- invitation through this one function, then send a person on to the Club
-- Arena tournament page (sign-in and the return trip work as before).
--
-- fn_ca_tournament_share_preview(p_tournament_id uuid) -> jsonb
--   {found:false} for a tournament that does not exist AND, in exactly the same
--   shape, for one that is private, VIP-only, or owned by a club or union that
--   is not public, not active or not a chip club. A caller cannot tell a hidden
--   tournament from a missing one.
--   {found:true, ...} otherwise: what any lobby card shows - name, game,
--   format, status, start time, buy-in and fee, guarantee (null when none),
--   bounty kind, free-buy, turbo, rebuys, late registration minutes, starting
--   chips, seats, and the club or union name unless the event hides it.
--
-- WHY SECURITY DEFINER, OPEN TO anon. The preview is drawn for a caller with no
-- account (a link-preview crawler, a signed-out friend). anon holds no SELECT
-- on clubs, so an invoker function could not check the club is public; the
-- definer reads exactly the columns above and nothing else. It never reads a
-- player, a registration, a wallet, a seat or a card, writes nothing, and takes
-- one uuid, so it cannot enumerate. Recorded as a deliberate public reader in
-- all four places the audits read (scripts/ci/definer-authorization.allowlist.json
-- anonPublicSurface, scripts/ci/definer-exposure-baseline.json
-- reviewedAnonReaders, docs/security/anon-executable-definers.json and
-- public.ca_browser_definer_allowlist below).
--
-- Amounts are chips; the caller prints them with no currency sign.
--
-- One transaction (production DDL policy rule 1). No hot-table lock: CREATE
-- FUNCTION and one row in a small allowlist table. No cron, no sweep.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_share_preview(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_t    record;
  v_club record;
  v_owner uuid;
BEGIN
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT t.id, t.name, t.game_type, t.variant, t.status, t.start_time,
         t.buy_in_amount, t.buy_in_fee, t.guaranteed_prize, t.is_pko,
         t.is_mystery_bounty, t.is_bounty, t.free_buy, t.is_turbo, t.is_rebuy,
         t.late_reg_mins, t.starting_chips, t.max_players, t.hide_club_name,
         t.is_private, t.is_vip_only, t.club_id, t.union_id
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id;

  IF NOT FOUND
     OR COALESCE(v_t.is_private, false)
     OR COALESCE(v_t.is_vip_only, false) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- A union event belongs to the union; otherwise to its club. A platform
  -- event (neither) has no owner to check.
  v_owner := COALESCE(v_t.union_id, v_t.club_id);
  IF v_owner IS NOT NULL THEN
    SELECT c.name, c.is_public, c.is_private, c.status, c.lifecycle_status, c.asset
      INTO v_club
      FROM public.clubs c
     WHERE c.id = v_owner;
    IF NOT FOUND
       OR NOT COALESCE(v_club.is_public, false)
       OR COALESCE(v_club.is_private, false)
       OR COALESCE(v_club.status, 'active') <> 'active'
       OR COALESCE(v_club.lifecycle_status, 'active') <> 'active'
       OR COALESCE(v_club.asset, 'chips') <> 'chips' THEN
      RETURN jsonb_build_object('found', false);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_t.id,
    'name', v_t.name,
    'game', v_t.game_type,
    'format', v_t.variant,
    'status', v_t.status,
    'startTime', v_t.start_time,
    'buyIn', COALESCE(v_t.buy_in_amount, 0),
    'fee', COALESCE(v_t.buy_in_fee, 0),
    'guarantee', CASE WHEN COALESCE(v_t.guaranteed_prize, 0) > 0 THEN v_t.guaranteed_prize END,
    'bounty', CASE
                WHEN COALESCE(v_t.is_mystery_bounty, false) THEN 'Mystery Bounty'
                WHEN COALESCE(v_t.is_pko, false) THEN 'PKO'
                WHEN COALESCE(v_t.is_bounty, false) THEN 'Bounty'
              END,
    'freeBuy', COALESCE(v_t.free_buy, false),
    'turbo', COALESCE(v_t.is_turbo, false),
    'rebuys', COALESCE(v_t.is_rebuy, false),
    'lateRegMinutes', v_t.late_reg_mins,
    'startingChips', v_t.starting_chips,
    'maxPlayers', v_t.max_players,
    'club', CASE
              WHEN v_owner IS NULL OR COALESCE(v_t.hide_club_name, false) THEN NULL
              ELSE v_club.name
            END
  );
END;
$$;

COMMENT ON FUNCTION public.fn_ca_tournament_share_preview(uuid) IS
  'Public preview of a shared tournament for smarter.poker/t/<id>: lobby-card facts only. Private, VIP-only and non-public-club events answer {found:false} exactly like a missing one. Read-only. 20261115161427.';

REVOKE ALL ON FUNCTION public.fn_ca_tournament_share_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_share_preview(uuid) TO anon, authenticated, service_role;

INSERT INTO public.ca_browser_definer_allowlist(proname, reason) VALUES (
  'fn_ca_tournament_share_preview',
  'Public tournament share preview (smarter.poker/t/<id>): one uuid in, lobby-card facts out (name, game, format, status, start, buy-in, fee, guarantee, bounty kind, flags, club name unless hidden). Private, VIP-only and non-public-club events answer exactly like a missing one. No player, registration, wallet, seat or card data; read-only; cannot enumerate.'
) ON CONFLICT (proname) DO NOTHING;

-- Postconditions: the signed-out door is open, it answers a missing event with
-- {found:false}, and it is read-only.
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.fn_ca_tournament_share_preview(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_ca_tournament_share_preview is not executable by anon';
  END IF;
  IF public.fn_ca_tournament_share_preview('00000000-0000-0000-0000-000000000000'::uuid)
       IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_tournament_share_preview did not answer a missing event with found=false';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_ca_tournament_share_preview(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'fn_ca_tournament_share_preview must be STABLE (read-only)';
  END IF;
END;
$$;

COMMIT;
