-- 20261107021555_short_share_links_for_hands.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-06, shared hand links):
--
-- A shared hand travels as /hub/club-arena/replay?h=<payload>: the hand rides
-- inside the address, 480-600 characters long. Messengers wrap or cut links
-- that long, a sender cannot take one back, and nobody can see whether it was
-- opened. Dan asked for all three to be fixed.
--
-- This adds ONE record table and four doors:
--   ca_shared_hands             token -> the SAME payload the long link carries,
--                               the sender, their Share & Invite code, a few
--                               preview fields, sent/revoked/view bookkeeping
--   fn_ca_shared_hand_reserve   the sender's token for this exact hand (one per
--                               sender and payload, reused), made when the hand
--                               is opened so the Link tap never waits on it
--   fn_ca_shared_hand_mark_sent the sender actually sent it (Link or Share)
--   fn_ca_shared_hand_open      PUBLIC read: anyone holding the link, signed in
--                               or not, gets the payload; counts a view unless
--                               the caller says it is a preview crawler; a
--                               revoked link or a deleted sender opens nothing
--   fn_ca_shared_hand_revoke    the sender stops sharing
--
-- PRIVACY. The table stores exactly what the long link already carries: what
-- the sender's replay showed them (their own cards marked private, holdings
-- shown at showdown, no opponent's unshown cards). Nothing here reads
-- hand_history or another player's cards. The preview fields are the hand
-- number, table name, stakes, pot, board and the sender's display name.
-- Deleted players are removed for good (Dan 2026-10-16): a deleted sender's
-- links stop opening.
--
-- No foreign keys: a record table must never lock a hot relation (CLAUDE.md
-- production DDL rule 7). No cron, no sweep: nothing here repairs anything.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.ca_shared_hands (
  token          text PRIMARY KEY CHECK (token ~ '^[A-HJ-NP-Za-km-z2-9]{8}$'),
  sender_id      uuid NOT NULL,
  payload        text NOT NULL CHECK (length(payload) BETWEEN 16 AND 8000 AND payload ~ '^[A-Za-z0-9_~.-]+$'),
  payload_md5    text NOT NULL,
  invite_code    text CHECK (invite_code IS NULL OR invite_code ~ '^[A-HJ-NP-Z2-9]{7}$'),
  preview        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  revoked_at     timestamptz,
  view_count     integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz
);

-- One live token per sender and hand: reserving again returns it.
CREATE UNIQUE INDEX IF NOT EXISTS ca_shared_hands_one_live_per_hand
  ON public.ca_shared_hands (sender_id, payload_md5)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ca_shared_hands_sender_recent
  ON public.ca_shared_hands (sender_id, created_at DESC);

COMMENT ON TABLE public.ca_shared_hands IS
  'Short shared-hand links (smarter.poker/h/<token>): the same payload as /replay?h=, its sender, invite code, preview fields and sent/revoked/view bookkeeping. 2026-11-06.';

ALTER TABLE public.ca_shared_hands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_shared_hands FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The preview fields: short strings only, nothing else is kept.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_clean_preview(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(k, left(v, 80)) FILTER (WHERE v IS NOT NULL AND v <> ''), '{}'::jsonb)
  FROM (
    SELECT k, NULLIF(btrim(COALESCE(p ->> k, '')), '') AS v
    FROM unnest(ARRAY['handNumber','tableName','stakes','pot','board','senderName','variant']) AS k
  ) s
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reserve: the caller's live token for this payload, created on first use.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_reserve(
  p_payload text,
  p_invite_code text DEFAULT NULL,
  p_preview jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_md5    text;
  v_row    public.ca_shared_hands%ROWTYPE;
  v_token  text;
  v_alpha  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  v_invite text := NULLIF(upper(btrim(COALESCE(p_invite_code, ''))), '');
  v_today  integer;
  v_try    integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  -- Length apart from the character set: a Postgres regex repetition count
  -- tops out at 255, so {16,8000} is not a valid pattern.
  IF p_payload IS NULL OR length(p_payload) NOT BETWEEN 16 AND 8000
     OR p_payload !~ '^[A-Za-z0-9_~.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'bad_payload');
  END IF;
  IF v_invite IS NOT NULL AND v_invite !~ '^[A-HJ-NP-Z2-9]{7}$' THEN
    v_invite := NULL;
  END IF;
  v_md5 := md5(p_payload);

  SELECT * INTO v_row FROM public.ca_shared_hands
   WHERE sender_id = v_uid AND payload_md5 = v_md5 AND revoked_at IS NULL;
  IF FOUND THEN
    IF v_invite IS NOT NULL AND v_row.invite_code IS DISTINCT FROM v_invite THEN
      UPDATE public.ca_shared_hands SET invite_code = v_invite WHERE token = v_row.token;
    END IF;
    RETURN jsonb_build_object('success', true, 'token', v_row.token,
      'sent', v_row.sent_at IS NOT NULL, 'views', v_row.view_count);
  END IF;

  -- A ceiling, not a product limit: nobody opens 500 hands a day by hand.
  SELECT count(*) INTO v_today FROM public.ca_shared_hands
   WHERE sender_id = v_uid AND created_at > now() - interval '1 day';
  IF v_today >= 500 THEN
    RETURN jsonb_build_object('success', false, 'code', 'too_many');
  END IF;

  LOOP
    v_try := v_try + 1;
    SELECT string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '')
      INTO v_token FROM generate_series(1, 8);
    BEGIN
      INSERT INTO public.ca_shared_hands (token, sender_id, payload, payload_md5, invite_code, preview)
      VALUES (v_token, v_uid, p_payload, v_md5, v_invite,
              public.fn_ca_shared_hand_clean_preview(COALESCE(p_preview, '{}'::jsonb)));
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- The random token was taken, or a concurrent call reserved this hand
      -- first. Prefer the existing live row.
      SELECT * INTO v_row FROM public.ca_shared_hands
       WHERE sender_id = v_uid AND payload_md5 = v_md5 AND revoked_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'token', v_row.token,
          'sent', v_row.sent_at IS NOT NULL, 'views', v_row.view_count);
      END IF;
      IF v_try >= 8 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'token', v_token, 'sent', false, 'views', 0);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Mark sent: the sender tapped Link or Share with this token.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_mark_sent(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  UPDATE public.ca_shared_hands
     SET sent_at = COALESCE(sent_at, now())
   WHERE token = p_token AND sender_id = v_uid AND revoked_at IS NULL;
  RETURN jsonb_build_object('success', FOUND);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Open: anyone holding the link. A preview crawler passes p_count = false.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_open(p_token text, p_count boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_row     public.ca_shared_hands%ROWTYPE;
  v_status  text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-HJ-NP-Za-km-z2-9]{8}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO v_row FROM public.ca_shared_hands WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT status INTO v_status FROM public.profiles WHERE id = v_row.sender_id;
  IF v_status IS NULL OR v_status = 'deleted' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('found', true, 'revoked', true);
  END IF;
  -- The sender looking at their own link is not a view.
  IF p_count AND auth.uid() IS DISTINCT FROM v_row.sender_id THEN
    UPDATE public.ca_shared_hands
       SET view_count = view_count + 1, last_viewed_at = now()
     WHERE token = p_token;
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'revoked', false,
    'payload', v_row.payload,
    'invite', v_row.invite_code,
    'preview', v_row.preview
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Revoke: the sender stops sharing. The next share makes a new token.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_revoke(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  UPDATE public.ca_shared_hands
     SET revoked_at = now()
   WHERE token = p_token AND sender_id = v_uid AND revoked_at IS NULL;
  RETURN jsonb_build_object('success', FOUND);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_clean_preview(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_reserve(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_shared_hand_reserve(text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_mark_sent(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_shared_hand_mark_sent(text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_open(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_shared_hand_open(text, boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_revoke(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_shared_hand_revoke(text) TO authenticated;

COMMIT;
