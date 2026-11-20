-- @live-proof: (to_regclass('smarter_private.horse_dealt_hole_cards') IS NOT NULL AND to_regprocedure('smarter_private.project_horse_dealt_hole_cards(uuid,jsonb,uuid)') IS NOT NULL AND to_regprocedure('smarter_private.prune_horse_dealt_hole_cards(integer)') IS NOT NULL AND strpos(pg_get_functiondef('public.ca_project_hand_stats_facts(uuid)'::regprocedure), 'PERFORM smarter_private.project_horse_dealt_hole_cards(p_hand_id, v_stats, v_table);')>0 AND NOT has_table_privilege('anon','smarter_private.horse_dealt_hole_cards','SELECT') AND NOT has_table_privilege('authenticated','smarter_private.horse_dealt_hole_cards','SELECT'))
-- 20261120014240_every_horse_dealt_hole_cards_are_kept_for_audit.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- EVERY HORSE'S DEALT HOLE CARDS ARE KEPT FOR AUDIT (Dan 2026-11-19, HORSE
-- DECISIONS lane). Dan ordered every Horse decision on every street audited.
-- The six 48-hour audits (agent-evidence hvh48-audit-01TLQer7J, reports A-F)
-- could price only about a quarter of the Horse decisions with exact cards:
-- a Horse's cards survived only where something else kept them - showdown
-- (hand_history.hole_cards), a ca_hand_facts row that put chips in (the
-- writer stores `invested > 0 ? cards : null`), table_hole_cards for about a
-- day, a sparse horse_hand_reviews row. A Horse that folded preflop for free,
-- and every Lightning fast fold, left nothing anywhere.
--
-- WHERE THE CARDS COME FROM. The engine already holds every dealt seat's
-- cards at settlement (holeCardsAll) and builds the private accepted-hand
-- stats payload from them (server/src/services/supabase/handFacts.ts,
-- writeHandFacts collectOnly). That payload now carries one more key,
-- `horse_hole_cards`: [{user_id, seat, cards:['As','Kd',...]}], Horses only
-- (roster isHorse === true), absent when no Horse was dealt in or while the
-- installed retention basis does not accept it (below). It is stored
-- by the same transaction that accepts the hand, in
-- hand_atomic_commits.post_commit_payload (service_role read only), for cash,
-- tournament and Lightning hands alike (fn_lightning_hand_stats_facts passes
-- the stats object through whole; its checks read facts/transfers only).
-- Measured on production 2026-11-19 for the last 30 minutes: 4,150 of 4,150
-- accepted hands carried stats_facts (1,986 tournament, 1,015 Lightning).
--
-- WHERE THEY ARE KEPT. smarter_private.horse_dealt_hole_cards, one row per
-- (hand_id, user_id): hand_id is hand_history.id and hand_atomic_commits.
-- hand_id, with seat, table_id, game_variant, played_at. RLS on, no policy,
-- no grant to PUBLIC, anon or authenticated; SELECT to service_role only for
-- audit tooling. No view, function, publication or client path reads it
-- (tests/horse-dealt-hole-cards-stay-private.law.test.ts). A Horse's unshown
-- cards in a player's hands would be a cheating vector.
--
-- HOW THEY GET THERE, WITHOUT TOUCHING HAND ACCEPTANCE. The existing durable
-- post-commit projector, ca_project_hand_stats_facts (called from the hand
-- projection outbox, after the hand is accepted), now ends with one call to
-- smarter_private.project_horse_dealt_hole_cards. It re-checks every entry
-- against the database itself: the user must be a profiles.is_horse = true
-- profile and must have a fact row in this hand at the same seat, and every
-- card must read as a real card. A malformed list keeps nothing for that hand
-- and raises a WARNING; it never fails the projection (a failed projection
-- would hold every later hand of the table behind it). Replays insert
-- nothing twice (ON CONFLICT DO NOTHING). No hot table is locked: no FK to
-- hand_history (an FK would take SHARE ROW EXCLUSIVE on it), no trigger on a
-- live table; only CREATE TABLE in smarter_private and two function bodies.
--
-- THE HAND-CONTENT RETENTION BASIS IS NOT TOUCHED HERE (review B1).
-- smarter_private.horse_compact_stats_basis refuses any unknown top-level
-- stats key; on 2026-10-25 a new key (horse_rollups) stopped
-- sp_prune_hand_history for eleven days (migration 20261105174453). Its
-- acceptance of horse_hole_cards is its own migration, 20261120025753, with no
-- pin that can refuse, and the engine sends the key only after
-- public.horse_stats_basis_accepted_keys() (that migration) lists it
-- (server/src/services/HorseStatsBasisContract.ts). This file can install
-- before or after it: until the engine sends the key, the projector below
-- simply finds no list.
--
-- RETENTION MATCHES hand_history. hand_history keeps a hand any human was
-- dealt into forever and prunes horse-only hands after
-- hand_history_retention_policy.horse_retention_days (8, Dan 2026-09-17).
-- smarter_private.prune_horse_dealt_hole_cards deletes a horse-only row only
-- once it is past that window AND its hand_history row is gone; a hand that
-- hand_history kept (a keeper later marked has_human) marks its rows kept
-- too. pg_cron runs it every ten minutes, bounded.
--
-- NO HORSE DECISION CHANGES. Nothing on the decision path reads the payload
-- key or the table; no option switch is needed.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pins$
BEGIN
  IF to_regclass('smarter_private.horse_dealt_hole_cards') IS NOT NULL THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_ALREADY_INSTALLED' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.hand_history_retention_policy') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.hand_history') IS NULL THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_DEPENDENCY_MISSING' USING ERRCODE = '55000';
  END IF;
  -- Production body read 2026-11-19. A changed body is refused, never
  -- patched blind. (The retention basis is 20261120025753's, unpinned.)
  IF md5(pg_get_functiondef('public.ca_project_hand_stats_facts(uuid)'::regprocedure))
       IS DISTINCT FROM '1fbfe441e124bff9317e4f8b1c3def8c' THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_SOURCE_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$pins$;

CREATE TABLE smarter_private.horse_dealt_hole_cards (
  hand_id      uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  seat         smallint    NOT NULL CHECK (seat BETWEEN 0 AND 10),
  table_id     uuid        NOT NULL,
  game_variant text        NOT NULL,
  hole_cards   text[]      NOT NULL CHECK (
    cardinality(hole_cards) BETWEEN 2 AND 7
    AND array_position(hole_cards, NULL) IS NULL
    AND array_to_string(hole_cards, ',') ~ '^[2-9TJQKA][shdc](,[2-9TJQKA][shdc]){1,6}$'),
  played_at    timestamptz NOT NULL,
  has_human    boolean     NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, user_id)
);
COMMENT ON TABLE smarter_private.horse_dealt_hole_cards IS
  'Every Horse''s own dealt hole cards per hand, for Horse decision audits. SERVICE ROLE ONLY: never exposed to any client, view, replay, rabbit hunt or realtime channel. Horses only (profiles.is_horse). Retention matches hand_history (migration 20261120014240).';
CREATE INDEX horse_dealt_hole_cards_horse_only_played_at
  ON smarter_private.horse_dealt_hole_cards (played_at) WHERE NOT has_human;
ALTER TABLE smarter_private.horse_dealt_hole_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.horse_dealt_hole_cards FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON smarter_private.horse_dealt_hole_cards TO service_role;

CREATE FUNCTION smarter_private.project_horse_dealt_hole_cards(
  p_hand_id uuid, p_stats jsonb, p_table_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, smarter_private
AS $function$
DECLARE
  v_list jsonb := p_stats->'horse_hole_cards';
  v_played timestamptz;
  v_variant text;
  v_has_human boolean;
  v_kept integer := 0;
BEGIN
  IF v_list IS NULL OR p_hand_id IS NULL OR p_table_id IS NULL THEN
    RETURN 0;
  END IF;
  BEGIN
    IF jsonb_typeof(v_list) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_list) NOT BETWEEN 1 AND 10
       OR jsonb_typeof(p_stats->'facts') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'horse_hole_cards_shape';
    END IF;
    SELECT (f->>'played_at')::timestamptz, f->>'game_variant'
      INTO v_played, v_variant
      FROM jsonb_array_elements(p_stats->'facts') f LIMIT 1;
    -- hand_history's own flag when the row is there (the projector reads it
    -- from the outbox join); otherwise any dealt seat that is not a Horse.
    SELECT h.has_human INTO v_has_human FROM public.hand_history h WHERE h.id = p_hand_id;
    v_has_human := coalesce(v_has_human, EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_stats->'facts') f
        LEFT JOIN public.profiles pr ON pr.id = (f->>'user_id')::uuid
       WHERE pr.is_horse IS NOT TRUE));
    INSERT INTO smarter_private.horse_dealt_hole_cards
      (hand_id, user_id, seat, table_id, game_variant, hole_cards, played_at, has_human)
    SELECT p_hand_id, (e->>'user_id')::uuid, (e->>'seat')::smallint, p_table_id, v_variant,
           ARRAY(SELECT jsonb_array_elements_text(e->'cards')), v_played, v_has_human
      FROM jsonb_array_elements(v_list) e
      -- HORSES ONLY, decided here and not by the payload.
      JOIN public.profiles pr ON pr.id = (e->>'user_id')::uuid AND pr.is_horse IS TRUE
     WHERE jsonb_typeof(e->'cards') = 'array'
       -- One deck: no card twice in a hand (the CHECK reads each card's form).
       AND (SELECT count(DISTINCT c) = count(*) FROM jsonb_array_elements_text(e->'cards') c)
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_stats->'facts') f
                    WHERE (f->>'user_id')::uuid = (e->>'user_id')::uuid
                      AND (f->'seat' IS NULL OR jsonb_typeof(f->'seat') = 'null'
                           OR (f->>'seat')::integer = (e->>'seat')::integer))
    ON CONFLICT (hand_id, user_id) DO NOTHING;
    GET DIAGNOSTICS v_kept = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'horse dealt hole cards not kept for hand % (%: %)', p_hand_id, SQLSTATE, SQLERRM;
    RETURN -1;
  END;
  RETURN v_kept;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.project_horse_dealt_hole_cards(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: smarter_private.project_horse_dealt_hole_cards
-- Runs the real insert path. The writer reports a swallowed error as -1, so
-- the probe asserts the count: one row for a Horse profile, none otherwise.
DO $probe$
DECLARE
  v_horse uuid := (SELECT id FROM public.profiles WHERE is_horse IS TRUE LIMIT 1);
  v_user uuid := coalesce(v_horse, gen_random_uuid());
  v_hand uuid := gen_random_uuid();
  v_kept integer;
BEGIN
  v_kept := smarter_private.project_horse_dealt_hole_cards(v_hand, jsonb_build_object(
    'version', 2, 'transfers', '[]'::jsonb,
    'facts', jsonb_build_array(jsonb_build_object('user_id', v_user, 'seat', 1,
      'played_at', now(), 'game_variant', 'nlh')),
    'horse_hole_cards', jsonb_build_array(jsonb_build_object('user_id', v_user, 'seat', 1,
      'cards', jsonb_build_array('As', 'Kd')))), gen_random_uuid());
  IF v_kept IS DISTINCT FROM (v_horse IS NOT NULL)::integer THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_PROBE_WRITER (%)', v_kept USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

CREATE FUNCTION smarter_private.prune_horse_dealt_hole_cards(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, smarter_private
AS $function$
DECLARE
  v_days integer;
  v_limit integer := greatest(least(coalesce(p_limit, 0), 50000), 1);
  v_cut timestamptz;
  v_deleted integer := 0;
BEGIN
  SELECT greatest(coalesce(horse_retention_days, 8), 1) INTO v_days
    FROM public.hand_history_retention_policy LIMIT 1;
  v_cut := now() - make_interval(days => coalesce(v_days, 8));
  -- The oldest horse-only rows past the window, bounded (one indexed page,
  -- one primary-key probe of hand_history per row). A hand that hand_history
  -- kept past its window by marking it has_human is kept here too, and leaves
  -- the horse-only index so it never blocks the next page. A horse-only hand
  -- that hand_history still holds for another reason (reported, an archived
  -- table, a paid jackpot, a sealed restoration case) stays until
  -- hand_history lets it go; the page is twice the delete budget so a few
  -- such hands at the head never stop the rest.
  WITH page AS (
    SELECT d.hand_id, d.user_id, h.id AS history_id, h.has_human AS history_human
      FROM (SELECT hand_id, user_id FROM smarter_private.horse_dealt_hole_cards
             WHERE NOT has_human AND played_at < v_cut
             ORDER BY played_at LIMIT v_limit * 2) d
      LEFT JOIN public.hand_history h ON h.id = d.hand_id
  ), kept AS (
    UPDATE smarter_private.horse_dealt_hole_cards k SET has_human = true
      FROM page p
     WHERE k.hand_id = p.hand_id AND k.user_id = p.user_id AND p.history_human IS TRUE
  )
  DELETE FROM smarter_private.horse_dealt_hole_cards x
   USING page p
   WHERE x.hand_id = p.hand_id AND x.user_id = p.user_id AND p.history_id IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.prune_horse_dealt_hole_cards(integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: smarter_private.prune_horse_dealt_hole_cards
DO $probe$
BEGIN
  INSERT INTO smarter_private.horse_dealt_hole_cards
    (hand_id, user_id, seat, table_id, game_variant, hole_cards, played_at, has_human)
  VALUES (gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 'nlh', '{As,Kd}',
          now() - interval '400 days', false);
  IF smarter_private.prune_horse_dealt_hole_cards(10) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_PROBE_PRUNE' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- The post-commit projector keeps the cards, in its own transaction.
DO $projector$
DECLARE
  src text := pg_get_functiondef('public.ca_project_hand_stats_facts(uuid)'::regprocedure);
  anchor text := '  RETURN jsonb_build_object(''ok'',true,''hand_id'',p_hand_id,''source_hash'',v_hash,';
  out text;
BEGIN
  IF (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_PROJECTOR_ANCHOR' USING ERRCODE = '55000';
  END IF;
  out := replace(src, anchor,
    E'  -- Every Horse''s own dealt cards (20261120014240). Never raises.\n'
    || E'  PERFORM smarter_private.project_horse_dealt_hole_cards(p_hand_id, v_stats, v_table);\n\n'
    || anchor);
  EXECUTE out;
END
$projector$;

-- @probe-for: public.ca_project_hand_stats_facts
-- Compiles and runs the new body. An accepted receipt cannot be fabricated on
-- production (hand_atomic_commits is append-only); the receipt path with the
-- new call is proven in scripts/ci/test-horse-dealt-hole-cards.py.
DO $probe$
BEGIN
  IF public.ca_project_hand_stats_facts(gen_random_uuid())->>'reason' IS DISTINCT FROM 'stats_facts_unavailable' THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_PROBE_PROJECTOR' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- The projector body is exactly what scripts/ci/test-horse-dealt-hole-cards.py
-- proves on PG17 from the same preimage.
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.ca_project_hand_stats_facts(uuid)'::regprocedure))
       IS DISTINCT FROM 'a5f235fbec8ac733e2c436e9c7546b71' THEN
    RAISE EXCEPTION 'HORSE_DEALT_HOLE_CARDS_POSTIMAGE_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$post$;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'horse-dealt-hole-cards-prune',
      '3,13,23,33,43,53 * * * *',
      $job$SET statement_timeout = '30s'; SET lock_timeout = '1s'; SELECT smarter_private.prune_horse_dealt_hole_cards(20000);$job$
    );
  END IF;
END
$cron$;

COMMIT;
