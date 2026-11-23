-- 20261123013356_a_game_invite_is_sent_by_the_server_to_a_clubmate_or_friend.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- A GAME INVITE IS SENT BY THE SERVER, TO A CLUBMATE OR A FRIEND (2026-11-22)
-- ============================================================================
--
-- WHAT A PLAYER SAW. The in-app invite (Invite Online Friend at a table, the
-- Heads Up "Specific Player" picker, Invite To Table on a friend's profile)
-- answered "Could Not Send Invite Right Now. Please Try Again." on every tap,
-- and the friend never received anything.
--
-- WHY. The browser wrote the friend's notification itself:
--   supabase.from('notifications').insert({ user_id: <the friend>, ... })
-- (src/services/TableInviteService.ts sendInAppTableInvite). Writing a row
-- into ANOTHER player's inbox from the browser is refused on production, and
-- deliberately so:
--   * the World Hub migration 20261020170027_explicit_reviewed_legacy_caller_access
--     records production's ACL as `authenticated` holding SELECT and UPDATE on
--     public.notifications, and no INSERT;
--   * the World Hub migration 20261020171316_mention_notification_trigger_authorization
--     asserts, before it installs, that no PERMISSIVE INSERT (or ALL) policy on
--     public.notifications admits PUBLIC, anon or authenticated ("Notifications
--     must retain owner/service-only INSERT under RLS"), and says "Never grant
--     browser notifications INSERT";
--   * the World Hub migration 20260421023031 dropped the last browser INSERT
--     policy (`notifications_insert_system`) because any player could write a
--     fake "system" notice into anyone's feed.
-- The only INSERT policy this repository ever wrote is 20260310's
-- "Service can insert notifications" FOR INSERT WITH CHECK (true), with no TO
-- clause: if it were still installed, any account (and the publishable key)
-- could write any notification to anyone, which is exactly the phishing hole
-- the World Hub closed. So the browser insert is refused where the policy is
-- correct and would be a hole where it is not. Neither is a way to send an
-- invite.
--
-- THE FIX. One narrow door, public.fn_send_game_invite, SECURITY DEFINER,
-- callable by a signed-in player, that sends exactly one `table_invite`
-- notification and decides everything in it on the server:
--   1. The game it names, read from its own row (tables, tournaments,
--      cash_games), with the rule the share door uses (tableInviteTarget in
--      src/lib/share.ts): a tournament is invited to as its tournament; the
--      one table link is a Heads Up seat held for a named player (the table
--      plus its token).
--   2. The sender can see that game: the same predicate the RESTRICTIVE
--      SELECT policies on tables and tournaments apply
--      ((club_id IS NULL AND union_id IS NULL) OR
--       fn_poker_can_read_games(COALESCE(union_id, club_id))). A game the
--      sender cannot read answers exactly like a missing one.
--   3. The recipient is an accepted friend of the sender (either direction of
--      public.friendships) or a member of the game's club scope
--      (fn_club_scope_ids(COALESCE(union_id, club_id)), any status the invite
--      picker itself lists). Anyone else: not_allowed. Never the sender.
--   4. Idempotent on (sender, recipient, game) for 60 seconds, the client's
--      own cooldown: a second tap answers with the first notification and
--      writes nothing. Serialised per sender with a transaction advisory lock,
--      so two quick taps cannot both write. "Game" is the game the invite
--      names after rule 1, so an MTT invited to from its table and from its
--      lobby is one invite.
--   5. At most 30 invites per sender in any 10 minutes (rate_limited, with
--      the seconds until the next one is allowed).
--   6. The title, the sentence and the link are built here, never taken from
--      the browser: the sender's arena handle (alias, then username: never a
--      real name, src/utils/playerDisplayName.ts), the game's own name, and
--      /hub/club-arena/<path> spelled exactly as every shared link spells it:
--      `i` the sender's club invite code (kept only when it is the sender's
--      own code in public.club_invite_links), `cluster` the table's own cash
--      game, `invite` the seat-hold token. Prefixed, so the push that mirrors
--      the row (fn_mirror_notification_to_push_outbox uses link/action_url as
--      the push URL) opens Club Arena too.
-- smarter_private.ca_game_invite_sends records each send (sender, recipient,
-- game, notification) for the window checks; each call prunes the sender's
-- own rows older than seven days.
--
-- WHAT THIS DOES NOT CHANGE. No policy and no grant on public.notifications.
-- No game, seat, wallet or money row is read for writing or written. Horses
-- are players (CLAUDE.md 10.5): nothing here reads is_horse.
--
-- Locks: CREATE TABLE and CREATE INDEX on a new smarter_private table only;
-- CREATE OR REPLACE FUNCTION. No hot relation is locked beyond the reads in
-- the probe (ACCESS SHARE).
--
-- Rollback: REVOKE EXECUTE ON FUNCTION public.fn_send_game_invite(...) FROM
-- authenticated, in a new migration. The client then reports the send as not
-- delivered, which is what it did before this file.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_send_game_invite(uuid,text,uuid,uuid,uuid,text,text)') IS NOT NULL AND to_regclass('smarter_private.ca_game_invite_sends') IS NOT NULL AND has_function_privilege('authenticated', 'public.fn_send_game_invite(uuid,text,uuid,uuid,uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_send_game_invite(uuid,text,uuid,uuid,uuid,text,text)', 'EXECUTE') AND NOT has_table_privilege('authenticated', 'smarter_private.ca_game_invite_sends', 'SELECT'))

BEGIN;

SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS smarter_private.ca_game_invite_sends (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id       uuid NOT NULL,
  recipient_id    uuid NOT NULL,
  -- 'tournament:<id>', 'table:<id>' or 'lightning:<cash game id>'
  target_key      text NOT NULL,
  -- No foreign key: an orphan row in a send log is harmless, a lock on
  -- notifications is not (CLAUDE.md section 2 rule 7).
  notification_id uuid,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ca_game_invite_sends_sender_sent_idx
  ON smarter_private.ca_game_invite_sends (sender_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS ca_game_invite_sends_pair_idx
  ON smarter_private.ca_game_invite_sends (sender_id, recipient_id, target_key, sent_at DESC);

ALTER TABLE smarter_private.ca_game_invite_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.ca_game_invite_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE smarter_private.ca_game_invite_sends TO service_role;

COMMENT ON TABLE smarter_private.ca_game_invite_sends IS
  'One row per in-app game invite fn_send_game_invite delivered: the 60 second repeat window and the 30 per 10 minutes sender limit read it. Pruned per sender after seven days by the same call. 20261123013356.';

CREATE OR REPLACE FUNCTION public.fn_send_game_invite(
  p_recipient_id  uuid,
  p_kind          text,
  p_table_id      uuid DEFAULT NULL,
  p_tournament_id uuid DEFAULT NULL,
  p_cluster_id    uuid DEFAULT NULL,
  p_invite_code   text DEFAULT NULL,
  p_invite_token  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_repeat_window constant interval := interval '60 seconds';
  c_rate_window   constant interval := interval '10 minutes';
  c_rate_limit    constant integer  := 30;
  v_uid           uuid := auth.uid();
  v_kind          text := lower(btrim(COALESCE(p_kind, '')));
  v_target        text;
  v_target_id     uuid;
  v_tournament_id uuid;
  v_table_id      uuid;
  v_cluster       uuid;
  v_club          uuid;
  v_union         uuid;
  v_scope         uuid;
  v_name          text;
  v_row_cluster   uuid;
  v_code          text := upper(btrim(COALESCE(p_invite_code, '')));
  v_token         text := NULLIF(btrim(COALESCE(p_invite_token, '')), '');
  v_key           text;
  v_query         text;
  v_path          text;
  v_url           text;
  v_sender        text;
  v_title         text;
  v_message       text;
  v_prior_id      uuid;
  v_prior_at      timestamptz;
  v_recent        integer;
  v_oldest        timestamptz;
  v_notification  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in_required');
  END IF;
  IF p_recipient_id IS NULL OR v_kind NOT IN ('cash', 'tournament', 'lightning') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_target');
  END IF;
  IF p_recipient_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;
  IF v_token IS NOT NULL AND v_token !~ '^[A-Za-z0-9_-]{4,128}$' THEN
    v_token := NULL;
  END IF;

  -- 1. The game the invite names, from its own row.
  IF v_kind = 'lightning' THEN
    IF p_cluster_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_target');
    END IF;
    SELECT g.club_id, g.union_id, g.name INTO v_club, v_union, v_name
      FROM public.cash_games g WHERE g.id = p_cluster_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    v_target := 'lightning';
    v_target_id := p_cluster_id;
  ELSIF v_kind = 'tournament' THEN
    IF p_table_id IS NOT NULL AND v_token IS NOT NULL THEN
      -- A Heads Up seat held for a named player: that table, with its token.
      SELECT t.club_id, t.union_id, t.tournament_id INTO v_club, v_union, v_tournament_id
        FROM public.tables t WHERE t.id = p_table_id;
      IF NOT FOUND OR v_tournament_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
      END IF;
      SELECT tr.name INTO v_name FROM public.tournaments tr WHERE tr.id = v_tournament_id;
      v_target := 'table';
      v_target_id := p_table_id;
      v_table_id := p_table_id;
    ELSE
      -- Every other tournament invite names the tournament, never the chair.
      v_tournament_id := p_tournament_id;
      IF v_tournament_id IS NULL AND p_table_id IS NOT NULL THEN
        SELECT t.tournament_id INTO v_tournament_id FROM public.tables t WHERE t.id = p_table_id;
      END IF;
      IF v_tournament_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
      END IF;
      SELECT tr.club_id, tr.union_id, tr.name INTO v_club, v_union, v_name
        FROM public.tournaments tr WHERE tr.id = v_tournament_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
      END IF;
      v_target := 'tournament';
      v_target_id := v_tournament_id;
    END IF;
  ELSE
    IF p_table_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_target');
    END IF;
    SELECT t.club_id, t.union_id, t.name, t.cluster_id INTO v_club, v_union, v_name, v_row_cluster
      FROM public.tables t WHERE t.id = p_table_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    v_target := 'table';
    v_target_id := p_table_id;
    v_table_id := p_table_id;
    -- The cash game travels only when it is the table's own.
    IF p_cluster_id IS NOT NULL AND p_cluster_id = v_row_cluster THEN
      v_cluster := p_cluster_id;
    END IF;
  END IF;

  -- 2. The sender can see the game (the RESTRICTIVE SELECT policies' rule).
  v_scope := COALESCE(v_union, v_club);
  IF v_scope IS NOT NULL AND NOT COALESCE(public.fn_poker_can_read_games(v_scope), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- 3. The recipient is a friend, or plays in the game's club scope.
  IF NOT EXISTS (
       SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND ((f.user_id = v_uid AND f.friend_id = p_recipient_id)
            OR (f.user_id = p_recipient_id AND f.friend_id = v_uid)))
     AND NOT (
       v_scope IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.club_members m
          WHERE m.user_id = p_recipient_id
            AND m.club_id = ANY (public.fn_club_scope_ids(v_scope))
            AND lower(COALESCE(m.status, '')) NOT IN ('banned', 'suspended', 'pending', 'rejected', 'left')))
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  -- 4. The link, spelled as every shared link spells it.
  IF v_code !~ '^[A-HJ-NP-Z2-9]{7}$' OR NOT EXISTS (
       SELECT 1 FROM public.club_invite_links l WHERE l.code = v_code AND l.inviter_id = v_uid) THEN
    v_code := NULL;
  END IF;
  v_query := concat_ws('&',
    CASE WHEN v_code IS NOT NULL THEN 'i=' || v_code END,
    CASE WHEN v_cluster IS NOT NULL THEN 'cluster=' || v_cluster::text END,
    CASE WHEN v_token IS NOT NULL THEN 'invite=' || v_token END);
  v_path := CASE v_target
              WHEN 'tournament' THEN '/tournaments/'
              WHEN 'lightning' THEN '/lightning/'
              ELSE '/table/'
            END || v_target_id::text
            || CASE WHEN v_query <> '' THEN '?' || v_query ELSE '' END;
  v_url := '/hub/club-arena' || v_path;

  -- 5 and 6. One invite per sender, recipient and game a minute; 30 in ten.
  PERFORM pg_advisory_xact_lock(hashtextextended('ca_game_invite:' || v_uid::text, 0));
  v_key := v_target || ':' || v_target_id::text;

  SELECT s.notification_id, s.sent_at INTO v_prior_id, v_prior_at
    FROM smarter_private.ca_game_invite_sends s
   WHERE s.sender_id = v_uid
     AND s.recipient_id = p_recipient_id
     AND s.target_key = v_key
     AND s.sent_at > now() - c_repeat_window
   ORDER BY s.sent_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true, 'notification_id', v_prior_id,
      'target', v_target, 'target_id', v_target_id, 'path', v_path, 'action_url', v_url,
      'retry_after_seconds', GREATEST(1, ceil(extract(epoch FROM (v_prior_at + c_repeat_window - now())))::integer));
  END IF;

  SELECT count(*), min(s.sent_at) INTO v_recent, v_oldest
    FROM smarter_private.ca_game_invite_sends s
   WHERE s.sender_id = v_uid AND s.sent_at > now() - c_rate_window;
  IF v_recent >= c_rate_limit THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'retry_after_seconds', GREATEST(1, ceil(extract(epoch FROM (v_oldest + c_rate_window - now())))::integer));
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.alias), ''), NULLIF(btrim(p.username), '')) INTO v_sender
    FROM public.profiles p WHERE p.id = v_uid;
  v_sender := COALESCE(v_sender, 'A Friend');
  v_name := COALESCE(NULLIF(btrim(v_name), ''),
              CASE v_kind WHEN 'tournament' THEN 'This Tournament'
                          WHEN 'lightning' THEN 'This Lightning Pool'
                          ELSE 'This Table' END);
  v_title := CASE v_kind WHEN 'tournament' THEN 'Tournament Invite'
                         WHEN 'lightning' THEN 'Lightning Table Invite'
                         ELSE 'Table Invite' END;
  v_message := left(v_sender || ' Invited You To Join ' || v_name, 300);

  INSERT INTO public.notifications (user_id, type, title, message, link, action_url, data, read)
  VALUES (
    p_recipient_id, 'table_invite', v_title, v_message, v_url, v_url,
    jsonb_build_object(
      'kind', v_kind,
      'table_id', v_table_id, 'tableId', v_table_id,
      'tournament_id', v_tournament_id, 'tournamentId', v_tournament_id,
      'cluster_id', COALESCE(v_cluster, CASE WHEN v_target = 'lightning' THEN v_target_id END),
      'clusterId', COALESCE(v_cluster, CASE WHEN v_target = 'lightning' THEN v_target_id END),
      'table_name', v_name, 'tableName', v_name,
      'invite_code', v_code, 'inviteCode', v_code,
      'invite_token', v_token, 'inviteToken', v_token,
      'from_user_id', v_uid, 'fromUserId', v_uid,
      'from_name', v_sender, 'fromName', v_sender,
      'action_url', v_url),
    false)
  RETURNING id INTO v_notification;

  IF v_notification IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  INSERT INTO smarter_private.ca_game_invite_sends (sender_id, recipient_id, target_key, notification_id)
  VALUES (v_uid, p_recipient_id, v_key, v_notification);
  DELETE FROM smarter_private.ca_game_invite_sends s
   WHERE s.sender_id = v_uid AND s.sent_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'notification_id', v_notification,
    'target', v_target, 'target_id', v_target_id, 'path', v_path, 'action_url', v_url);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_send_game_invite(uuid, text, uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_send_game_invite(uuid, text, uuid, uuid, uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_send_game_invite(uuid, text, uuid, uuid, uuid, text, text) IS
  'The one door for an in-app game invite: one table_invite notification to an accepted friend or a member of the game''s club scope, for a game the sender can see; the title, sentence and link built here; idempotent per sender, recipient and game for 60 s; at most 30 per sender in 10 minutes. 20261123013356.';

-- @probe-for: public.fn_send_game_invite
DO $probe$
DECLARE
  v_me uuid := gen_random_uuid();
  r    jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
  r := public.fn_send_game_invite(v_me, 'tournament', NULL, gen_random_uuid(), NULL, 'ABC2345', NULL);
  IF r->>'reason' IS DISTINCT FROM 'self' THEN
    RAISE EXCEPTION 'probe: a self invite answered %', r;
  END IF;
  r := public.fn_send_game_invite(gen_random_uuid(), 'tournament', NULL, gen_random_uuid(), NULL, 'ABC2345', NULL);
  IF r->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'probe: an unknown tournament answered %', r;
  END IF;
  r := public.fn_send_game_invite(gen_random_uuid(), 'cash', gen_random_uuid(), NULL, gen_random_uuid(), NULL, NULL);
  IF r->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'probe: an unknown table answered %', r;
  END IF;
  r := public.fn_send_game_invite(gen_random_uuid(), 'lightning', NULL, NULL, gen_random_uuid(), NULL, NULL);
  IF r->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'probe: an unknown Lightning game answered %', r;
  END IF;
  r := public.fn_send_game_invite(gen_random_uuid(), 'poker', NULL, NULL, NULL, NULL, NULL);
  IF r->>'reason' IS DISTINCT FROM 'invalid_target' THEN
    RAISE EXCEPTION 'probe: an unknown kind answered %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
