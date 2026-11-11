-- 20261110213942_lightning_preaction_record.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- THE LIGHTNING PRE-ACTION RECORD (2026-11-10). Dan, in the big blind: "i
-- clicked check fold but it didn't move me ... it made me hit fold again."
-- Hand 58348210's cause could not be proven because nothing recorded what the
-- engine did with a player's pre-action. The engine now records every arm
-- that reaches a Lightning room's pre-action door and every consequence of it
-- (server/src/lightning/LightningPreActionRecord.ts): set, refused, pending,
-- released, executed, rearmed, cleared, and held (the arm persisting across a
-- socket drop, reconnect or resync). Each row names the player, the room
-- (pool session), the hand, the street and the hand's action sequence at that
-- moment. This file is the database half.
--
--   public.lightning_preaction_event   one row per event, append only. No
--                                      foreign key to any hot table (CLAUDE.md
--                                      section 2 rule 7): an orphan row in a
--                                      record is harmless, a lock is not.
--   fn_lightning_preaction_record      the engine's door (service_role only).
--                                      Takes a batch; each event carries its
--                                      own id, so a retry after an unknown
--                                      outcome inserts nothing twice. It also
--                                      keeps the table bounded: each call
--                                      deletes at most 2,000 rows older than
--                                      fourteen days. No cron, no sweep.
--   fn_lightning_preaction_trace       read-only: "what did the engine hold
--                                      for each player of this hand, and
--                                      when", by hand id (service_role only,
--                                      for operators and agents through the
--                                      read-only workflows).
--
-- HORSES ARE PLAYERS (CLAUDE.md 10.5): nothing here reads whether a player is
-- a horse. NO CARDS, NO SECRETS: never a card, a credential or a token.
--
-- New table and two new functions: no lock on any existing relation, so no
-- install window.

BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.lightning_preaction_event (
  event_id          uuid PRIMARY KEY,
  kind              text NOT NULL CHECK (kind IN
                      ('set','refused','pending','released','executed','rearmed','cleared','held')),
  player_id         uuid NOT NULL,
  hand_id           uuid,
  cluster_id        uuid,
  requested_hand_id text,
  room_id           text,
  action            text,
  detail            text,
  to_call           numeric(14,2),
  stage             text,
  action_seq        integer,
  at                timestamptz NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lightning_preaction_event IS
  'What the engine did with each Lightning pre-action (LightningPreActionRecord.ts): one row per event, bounded to fourteen days by fn_lightning_preaction_record.';

CREATE INDEX lightning_preaction_event_hand_at_idx
  ON public.lightning_preaction_event (hand_id, at);
CREATE INDEX lightning_preaction_event_player_at_idx
  ON public.lightning_preaction_event (player_id, at);
CREATE INDEX lightning_preaction_event_requested_hand_idx
  ON public.lightning_preaction_event (requested_hand_id)
  WHERE requested_hand_id IS NOT NULL;
CREATE INDEX lightning_preaction_event_recorded_at_idx
  ON public.lightning_preaction_event (recorded_at);

ALTER TABLE public.lightning_preaction_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightning_preaction_event FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_lightning_preaction_record(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_inserted integer;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.lightning_preaction_event
    (event_id, kind, player_id, hand_id, cluster_id, requested_hand_id, room_id,
     action, detail, to_call, stage, action_seq, at)
  SELECT (e->>'event_id')::uuid,
         e->>'kind',
         (e->>'player_id')::uuid,
         NULLIF(e->>'hand_id','')::uuid,
         NULLIF(e->>'cluster_id','')::uuid,
         left(e->>'requested_hand_id', 120),
         left(e->>'room_id', 120),
         left(e->>'action', 120),
         left(e->>'detail', 120),
         (e->>'to_call')::numeric,
         left(e->>'stage', 40),
         CASE WHEN e->>'action_seq' ~ '^[0-9]{1,6}$' THEN (e->>'action_seq')::integer END,
         (e->>'at')::timestamptz
  FROM jsonb_array_elements(p_events) AS e
  WHERE e->>'kind' IN ('set','refused','pending','released','executed','rearmed','cleared','held')
    AND e->>'event_id' ~* '^[0-9a-f-]{36}$'
    AND e->>'player_id' ~* '^[0-9a-f-]{36}$'
  LIMIT 1000
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Retention: bounded work per call, the oldest rows past fourteen days.
  DELETE FROM public.lightning_preaction_event
  WHERE event_id IN (
    SELECT event_id FROM public.lightning_preaction_event
    WHERE recorded_at < now() - interval '14 days'
    ORDER BY recorded_at
    LIMIT 2000
  );

  RETURN v_inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_lightning_preaction_record(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_preaction_record(jsonb) TO service_role;

CREATE FUNCTION public.fn_lightning_preaction_trace(p_hand_id uuid)
RETURNS TABLE (
  at                timestamptz,
  player_id         uuid,
  kind              text,
  action            text,
  detail            text,
  to_call           numeric,
  stage             text,
  action_seq        integer,
  requested_hand_id text,
  room_id           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT e.at, e.player_id, e.kind, e.action, e.detail, e.to_call, e.stage,
         e.action_seq, e.requested_hand_id, e.room_id
  FROM public.lightning_preaction_event e
  WHERE e.hand_id = p_hand_id
     OR e.requested_hand_id = p_hand_id::text
  ORDER BY e.at, e.recorded_at;
$fn$;

REVOKE ALL ON FUNCTION public.fn_lightning_preaction_trace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_preaction_trace(uuid) TO service_role;

COMMIT;
