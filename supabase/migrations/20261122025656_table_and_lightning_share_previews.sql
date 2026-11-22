-- 20261122025656_table_and_lightning_share_previews.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Mirrors migration 20261115161427 (fn_ca_tournament_share_preview) for cash
-- tables and Lightning fast-fold pools so signed-out visitors and chat link
-- crawlers opening smarter.poker/g/<tableId> or smarter.poker/l/<clusterId>
-- receive rich lobby-card previews rather than a generic fallback card.
--
-- 1. public.fn_ca_table_share_preview(p_table_id uuid) -> jsonb
--    Returns {"found": false} for NULL, a missing table, a deleted/archived/
--    closed/template table, a private/VIP-only/password-protected table (or
--    one whose parent cluster is disabled, closed, paused, frozen, dead,
--    private or VIP-only), or a table whose owning club/union is missing, not
--    public, private, inactive, or neither a chip club nor the platform
--    Diamond Arena. A caller cannot tell a hidden or private table apart from
--    a non-existent UUID.
--    Returns {"found": true, "kind": "table", ...} otherwise with safe public
--    lobby-card facts only.
--
-- 2. public.fn_ca_lightning_share_preview(p_cluster_id uuid) -> jsonb
--    Returns {"found": false} for NULL, a missing cluster, a disabled/closed/
--    paused/frozen/dead cluster, a non-Lightning cluster, a private/VIP-only
--    cluster, or a cluster whose owning club/union is missing, not public,
--    private, inactive, or neither a chip club nor the platform Diamond Arena.
--    Returns {"found": true, "kind": "lightning", ...} otherwise with safe
--    public lobby-card facts only.
--
-- WHY SECURITY DEFINER, OPEN TO anon. Link-preview crawlers and signed-out
-- friends hold no account and anon holds no SELECT on clubs, cash_games or
-- tables. Both functions are STABLE (read-only), take one uuid (cannot
-- enumerate), never touch player, seat, card, hand, wallet or chat tables,
-- and redact every non-public/private row identically to a missing uuid.
-- Recorded as deliberate public readers in all four audit surfaces:
--   - scripts/ci/definer-authorization.allowlist.json (anonPublicSurface)
--   - scripts/ci/definer-exposure-baseline.json (reviewedAnonReaders)
--   - docs/security/anon-executable-definers.json
--   - public.ca_browser_definer_allowlist below
--
-- One transaction (production DDL policy rule 1). No hot-table lock: CREATE
-- FUNCTION and two rows in a small allowlist table. No cron, no sweep.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_ca_table_share_preview(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_t         record;
  v_cluster   record;
  v_club      record;
  v_union     record;
  v_owner     uuid;
  v_club_name text;
  v_asset     text;
BEGIN
  IF p_table_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT t.id, t.name, t.game_variant, t.game_type, t.stakes,
         t.small_blind, t.big_blind, t.max_players, t.current_players,
         t.min_buy_in, t.max_buy_in, t.min_buyin, t.max_buyin,
         t.status, t.lifecycle, t.terminal_closed_at,
         t.is_deleted, t.deleted_at, t.is_template,
         t.is_private, t.is_vip_only, t.hide_club_name,
         t.all_in_or_fold, t.bomb_pot_enabled, t.straddle_enabled,
         t.cluster_id, t.club_id, t.union_id, t.settings
    INTO v_t
    FROM public.tables t
   WHERE t.id = p_table_id;

  IF NOT FOUND
     OR COALESCE(v_t.is_deleted, false)
     OR v_t.deleted_at IS NOT NULL
     OR COALESCE(v_t.is_template, false)
     OR COALESCE(v_t.is_private, false)
     OR COALESCE(v_t.is_vip_only, false)
     OR v_t.terminal_closed_at IS NOT NULL
     OR lower(COALESCE(v_t.status, '')) IN ('deleted', 'archived', 'closed', 'completed', 'cancelled', 'ended')
     OR lower(COALESCE(v_t.lifecycle, '')) = 'closed'
     OR (jsonb_typeof(v_t.settings) = 'object'
         AND (v_t.settings->'is_private' = 'true'::jsonb
              OR v_t.settings->'is_vip_only' = 'true'::jsonb
              OR NULLIF(btrim(COALESCE(v_t.settings->>'password', '')), '') IS NOT NULL
              OR NULLIF(btrim(COALESCE(v_t.settings->>'password_hash', '')), '') IS NOT NULL)) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_t.cluster_id IS NOT NULL THEN
    SELECT g.enabled, g.closed_at, g.cluster_mode, g.ruleset_snapshot
      INTO v_cluster
      FROM public.cash_games g
     WHERE g.id = v_t.cluster_id;
    IF FOUND AND (
         NOT COALESCE(v_cluster.enabled, false)
         OR v_cluster.closed_at IS NOT NULL
         OR lower(COALESCE(v_cluster.cluster_mode, '')) IN ('paused', 'frozen', 'dead')
         OR (jsonb_typeof(v_cluster.ruleset_snapshot) = 'object'
             AND jsonb_typeof(v_cluster.ruleset_snapshot->'options') = 'object'
             AND (v_cluster.ruleset_snapshot->'options'->'is_private' = 'true'::jsonb
                  OR v_cluster.ruleset_snapshot->'options'->'is_vip_only' = 'true'::jsonb))
       ) THEN
      RETURN jsonb_build_object('found', false);
    END IF;
  END IF;

  -- A union table belongs to the union; otherwise to its club. Fail closed if
  -- unowned or if the owner is not a public active chip club or the platform
  -- Diamond Arena.
  v_owner := COALESCE(v_t.union_id, v_t.club_id);
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT c.name, c.is_public, c.is_private, c.status, c.lifecycle_status, c.asset, c.is_platform
    INTO v_club
    FROM public.clubs c
   WHERE c.id = v_owner;

  IF FOUND THEN
    v_asset := COALESCE(v_club.asset, 'chips');
    IF NOT COALESCE(v_club.is_public, false)
       OR COALESCE(v_club.is_private, false)
       OR COALESCE(v_club.status, 'active') <> 'active'
       OR COALESCE(v_club.lifecycle_status, 'active') <> 'active'
       OR NOT (
         v_asset = 'chips'
         OR (v_asset = 'diamonds' AND COALESCE(v_club.is_platform, false))
       ) THEN
      RETURN jsonb_build_object('found', false);
    END IF;
    v_club_name := v_club.name;
  ELSIF v_t.union_id IS NOT NULL THEN
    SELECT u.name, u.is_public
      INTO v_union
      FROM public.unions u
     WHERE u.id = v_t.union_id;
    IF NOT FOUND OR NOT COALESCE(v_union.is_public, false) THEN
      RETURN jsonb_build_object('found', false);
    END IF;
    v_club_name := v_union.name;
    v_asset := 'chips';
  ELSE
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'kind', 'table',
    'id', v_t.id,
    'name', v_t.name,
    'game', COALESCE(NULLIF(btrim(v_t.game_variant), ''), NULLIF(btrim(v_t.game_type), '')),
    'stakes', COALESCE(
      NULLIF(btrim(v_t.stakes), ''),
      CASE
        WHEN v_t.small_blind IS NOT NULL AND v_t.big_blind IS NOT NULL
        THEN public.fn_cash_stakes_label(v_t.small_blind, v_t.big_blind, COALESCE(v_t.game_variant, v_t.game_type, 'nlh'))
      END
    ),
    'smallBlind', v_t.small_blind,
    'bigBlind', v_t.big_blind,
    'maxPlayers', v_t.max_players,
    'currentPlayers', COALESCE(v_t.current_players, 0),
    'minBuyIn', COALESCE(v_t.min_buy_in, v_t.min_buyin),
    'maxBuyIn', COALESCE(v_t.max_buy_in, v_t.max_buyin),
    'status', v_t.status,
    'isAllInOrFold', COALESCE(v_t.all_in_or_fold, false),
    'isBombPot', COALESCE(v_t.bomb_pot_enabled, false),
    'isStraddle', COALESCE(v_t.straddle_enabled, false),
    'clusterId', v_t.cluster_id,
    'club', CASE
              WHEN COALESCE(v_t.hide_club_name, false) THEN NULL
              ELSE v_club_name
            END,
    'asset', v_asset
  );
END;
$$;

COMMENT ON FUNCTION public.fn_ca_table_share_preview(uuid) IS
  'Public preview of a shared cash table for smarter.poker/g/<id>: lobby-card facts only. Private, VIP-only, password-protected, deleted, closed and non-public-club tables answer {found:false} exactly like a missing one. Read-only. 20261122025656.';

REVOKE ALL ON FUNCTION public.fn_ca_table_share_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_table_share_preview(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_lightning_share_preview(p_cluster_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_g          record;
  v_club       record;
  v_union      record;
  v_owner      uuid;
  v_club_name  text;
  v_asset      text;
  v_min_buy_in numeric;
  v_max_buy_in numeric;
  v_hide_club  boolean := false;
BEGIN
  IF p_cluster_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT g.id, g.club_id, g.union_id, g.name, g.variant, g.sb, g.bb,
         g.handedness, g.ruleset_snapshot, g.enabled, g.state,
         g.closed_at, g.cluster_mode, g.lightning_enabled
    INTO v_g
    FROM public.cash_games g
   WHERE g.id = p_cluster_id;

  IF NOT FOUND
     OR NOT COALESCE(v_g.enabled, false)
     OR v_g.closed_at IS NOT NULL
     OR lower(COALESCE(v_g.cluster_mode, '')) IN ('paused', 'frozen', 'dead')
     OR (NOT COALESCE(v_g.lightning_enabled, false)
         AND lower(COALESCE(v_g.cluster_mode, '')) NOT IN ('pending_on', 'lightning', 'pending_off', 'draining'))
     OR (jsonb_typeof(v_g.ruleset_snapshot) = 'object'
         AND jsonb_typeof(v_g.ruleset_snapshot->'options') = 'object'
         AND (v_g.ruleset_snapshot->'options'->'is_private' = 'true'::jsonb
              OR v_g.ruleset_snapshot->'options'->'is_vip_only' = 'true'::jsonb)) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_owner := COALESCE(v_g.union_id, v_g.club_id);
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT c.name, c.is_public, c.is_private, c.status, c.lifecycle_status, c.asset, c.is_platform
    INTO v_club
    FROM public.clubs c
   WHERE c.id = v_owner;

  IF FOUND THEN
    v_asset := COALESCE(v_club.asset, 'chips');
    IF NOT COALESCE(v_club.is_public, false)
       OR COALESCE(v_club.is_private, false)
       OR COALESCE(v_club.status, 'active') <> 'active'
       OR COALESCE(v_club.lifecycle_status, 'active') <> 'active'
       OR NOT (
         v_asset = 'chips'
         OR (v_asset = 'diamonds' AND COALESCE(v_club.is_platform, false))
       ) THEN
      RETURN jsonb_build_object('found', false);
    END IF;
    v_club_name := v_club.name;
  ELSIF v_g.union_id IS NOT NULL THEN
    SELECT u.name, u.is_public
      INTO v_union
      FROM public.unions u
     WHERE u.id = v_g.union_id;
    IF NOT FOUND OR NOT COALESCE(v_union.is_public, false) THEN
      RETURN jsonb_build_object('found', false);
    END IF;
    v_club_name := v_union.name;
    v_asset := 'chips';
  ELSE
    RETURN jsonb_build_object('found', false);
  END IF;

  IF jsonb_typeof(v_g.ruleset_snapshot) = 'object' THEN
    IF (v_g.ruleset_snapshot->>'min_buyin_bb') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_min_buy_in := round(v_g.bb * (v_g.ruleset_snapshot->>'min_buyin_bb')::numeric, 2);
    END IF;
    IF (v_g.ruleset_snapshot->>'max_buyin_bb') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_max_buy_in := round(v_g.bb * (v_g.ruleset_snapshot->>'max_buyin_bb')::numeric, 2);
    END IF;
    IF jsonb_typeof(v_g.ruleset_snapshot->'options') = 'object'
       AND v_g.ruleset_snapshot->'options'->'hide_club_name' = 'true'::jsonb THEN
      v_hide_club := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'kind', 'lightning',
    'id', v_g.id,
    'name', v_g.name,
    'game', v_g.variant,
    'stakes', public.fn_cash_stakes_label(v_g.sb, v_g.bb, COALESCE(v_g.variant, 'nlh')),
    'smallBlind', v_g.sb,
    'bigBlind', v_g.bb,
    'maxPlayers', v_g.handedness,
    'minBuyIn', v_min_buy_in,
    'maxBuyIn', v_max_buy_in,
    'status', COALESCE(NULLIF(btrim(v_g.cluster_mode), ''), v_g.state),
    'club', CASE WHEN v_hide_club THEN NULL ELSE v_club_name END,
    'asset', v_asset
  );
END;
$$;

COMMENT ON FUNCTION public.fn_ca_lightning_share_preview(uuid) IS
  'Public preview of a shared Lightning fast-fold cluster for smarter.poker/l/<id>: lobby-card facts only. Private, VIP-only, disabled, closed, non-Lightning and non-public-club clusters answer {found:false} exactly like a missing one. Read-only. 20261122025656.';

REVOKE ALL ON FUNCTION public.fn_ca_lightning_share_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_lightning_share_preview(uuid) TO anon, authenticated, service_role;

INSERT INTO public.ca_browser_definer_allowlist(proname, reason) VALUES
  (
    'fn_ca_table_share_preview',
    'Public table share preview (smarter.poker/g/<id>): one uuid in, lobby-card facts out (name, game, stakes, blinds, max/current players, buy-in band, status, rule flags, cluster id, club name unless hidden, asset). Private, VIP-only, password-protected, deleted, closed and non-public-club tables answer {found:false} exactly like a missing id. No player, seat, card, hand, wallet or chat data; read-only; cannot enumerate.'
  ),
  (
    'fn_ca_lightning_share_preview',
    'Public Lightning cluster share preview (smarter.poker/l/<id>): one uuid in, lobby-card facts out (name, game, stakes, blinds, max players, buy-in band, status, club name unless hidden, asset). Private, VIP-only, disabled, closed, non-Lightning and non-public-club clusters answer {found:false} exactly like a missing id. No player, seat, card, hand, wallet or chat data; read-only; cannot enumerate.'
  )
ON CONFLICT (proname) DO NOTHING;

-- Pre-commit execution probes (scripts/ci/migration-function-probes.mjs).
-- @probe-for: public.fn_ca_table_share_preview
DO $probe$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.fn_ca_table_share_preview('00000000-0000-0000-0000-000000000000'::uuid);
  IF v_res IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_table_share_preview probe failed: %', v_res;
  END IF;
  IF public.fn_ca_table_share_preview(NULL::uuid) IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_table_share_preview NULL probe failed';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_lightning_share_preview
DO $probe$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.fn_ca_lightning_share_preview('00000000-0000-0000-0000-000000000000'::uuid);
  IF v_res IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_lightning_share_preview probe failed: %', v_res;
  END IF;
  IF public.fn_ca_lightning_share_preview(NULL::uuid) IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_lightning_share_preview NULL probe failed';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- Postconditions: both signed-out doors are open, both answer a missing id
-- with {found:false}, and both are STABLE (read-only).
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.fn_ca_table_share_preview(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_ca_table_share_preview is not executable by anon';
  END IF;
  IF NOT has_function_privilege('anon', 'public.fn_ca_lightning_share_preview(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_ca_lightning_share_preview is not executable by anon';
  END IF;
  IF public.fn_ca_table_share_preview('00000000-0000-0000-0000-000000000000'::uuid)
       IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_table_share_preview did not answer a missing table with found=false';
  END IF;
  IF public.fn_ca_lightning_share_preview('00000000-0000-0000-0000-000000000000'::uuid)
       IS DISTINCT FROM '{"found": false}'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_lightning_share_preview did not answer a missing cluster with found=false';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_ca_table_share_preview(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'fn_ca_table_share_preview must be STABLE (read-only)';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_ca_lightning_share_preview(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'fn_ca_lightning_share_preview must be STABLE (read-only)';
  END IF;
END;
$$;

COMMIT;
