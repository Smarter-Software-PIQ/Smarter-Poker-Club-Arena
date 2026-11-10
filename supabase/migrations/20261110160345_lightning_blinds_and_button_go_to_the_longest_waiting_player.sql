-- @install-window: daily-maintenance
-- @locks: public.lightning_pool_slot
-- @live-proof: (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lightning_pool_slot' AND column_name = 'hands_since_button') = 1
-- @live-proof: position('BY RECENCY (20261110)' in pg_get_functiondef('public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure)) > 0 AND position('BY RECENCY (20261110)' in pg_get_functiondef('public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)'::regprocedure)) > 0
-- @live-proof: position('handsSinceButton' in pg_get_functiondef('public.fn_lightning_matcher_snapshot(uuid,timestamp with time zone,uuid[],jsonb)'::regprocedure)) > 0 AND position('hands_since_button' in pg_get_functiondef('public.fn_lightning_instance_releases_its_reservations()'::regprocedure)) > 0
-- 20261110160345_lightning_blinds_and_button_go_to_the_longest_waiting_player.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner, Dan, 2026-11-10 09:52 Chicago):
--
--   "investigate how players are seated on the BB, SB and Button. I was SB 3
--    hands in a row and was on the button or in the bb multiple times within
--    a couple hands. this needs to be truly fair and corrected."
--
-- THE RULE AS IT WAS. A Lightning hand is formed from a pool, so there is no
-- ring for the blinds to walk round; each formation decides them:
--   - big blind: fn_lightning_blind_order (P2): an unresolved big blind
--     obligation, then a newcomer, then the oldest last_bb_at. Fair, and
--     unchanged here.
--   - small blind: the NEXT player in that same big-blind order. Paying a
--     small blind does not move last_bb_at, so the player who just posted it
--     is still second in line and posts it again whenever somebody older is
--     the big blind. Nothing ever read hands_since_sb.
--   - button (P3, position_fairness on in every Cluster): the member with the
--     FEWEST LIFETIME buttons in the Cluster (lightning_blind_ledger
--     .btn_count). A player whose lifetime count lags takes the button every
--     hand until they catch up.
--
-- MEASURED BEFORE (production, read only, 2026-11-10 12:54Z to 15:54Z: 8,439
-- hands in two Clusters, 76 players with 100 or more hands, 49,207 player
-- hands, average 5.95 seated, so the fair share of each seat is 16.8 per 100):
--               per 100   per player     back to back   gap p50 / p90 / max
--   big blind    16.81    13.9 - 21.0         1.3%          6 / 9 / 15
--   small blind  16.83    12.9 - 20.1        28.5%          5 / 13 / 47
--   button       16.57     0.0 - 61.8        22.3%          4 / 12 / 217
-- Dan's own run (player ...2af765, 15:47Z to 15:49Z): small blind, small
-- blind, big blind, -, -, small blind, -, small blind, small blind, big blind.
--
-- THE RULE NOW, the one a fast-fold pool uses: each blind and the button go
-- to the player who has gone LONGEST WITHOUT IT, counted in that player's own
-- dealt hands, so every player pays one small blind, one big blind and holds
-- the button about once per table size, and nobody holds the same one twice
-- in a row while anybody else at the table is owed it.
--   - big blind: unchanged (P2).
--   - small blind: of the non-entry players, the most hands since their last
--     small blind (lightning_pool_slot.hands_since_sb, which formation already
--     keeps), then P2 as before. In fn_lightning_match_plan (one per group,
--     chosen before the groups are filled, so each group's small blind beats
--     every other non-blind member on the same key) and in
--     fn_lightning_form_hand (the barrier's own choice), the same key.
--   - button and the seats behind it: P3 fills from the button backward with
--     the member who has gone the most hands without the button (the new
--     lightning_pool_slot.hands_since_button), then the one who held it
--     longest ago (last_button_at, never first), then the queue rule as
--     before. The cut-off is therefore the next button, as at a ring table.
--   - hands_since_button is kept exactly like hands_since_sb: zero for the
--     hand's button, one more for every other seat of the hand, and given
--     back by the voided-hand trigger from the slot's own dealt hands.
--   - the shadow snapshot carries the two counters and last_button_at, so the
--     engine's model (LightningMatcherModel, same pull request) plans by the
--     same rule; a snapshot without them is planned by the old rule.
--
-- WHY THE DAILY WINDOW. ADD COLUMN takes ACCESS EXCLUSIVE on
-- lightning_pool_slot, which every formation writes (CLAUDE.md section 2 rule
-- 10). The column has a constant default, so no row is rewritten and no row is
-- written: every open slot starts at zero, and until counts differ the button
-- goes to whoever held it longest ago.
--
-- Each function is patched in place from its installed image by exact anchor
-- (the house pattern of 20261026131624): every anchor must occur exactly once
-- or the transaction aborts, so an unknown edit is never overwritten.
-- Production images read 2026-11-10 (SELECT pg_get_functiondef/md5, no DDL):
--   fn_lightning_form_hand                       6c6998dd2bfaf129c7b95d323b39d186
--   fn_lightning_match_plan                      7e6cd1a61895cab0f7b748f9c13da260
--   fn_lightning_matcher_snapshot                db71faeb17ed67d928550b390bbd0ff0
--   fn_lightning_instance_releases_its_reservations 6c5e5a119c75dd4cc6c69c6ae84ec376
--
-- Horses are players (CLAUDE.md 10.5): nothing here reads a horse marker. No
-- money, seat or ledger row is written. Not a repair job.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE public.lightning_pool_slot
  ADD COLUMN IF NOT EXISTS hands_since_button integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.lightning_pool_slot.hands_since_button IS
  'Dealt hands since this slot last held the button (0 = held it in its last hand). P3 seats the button by it (20261110).';

DO $by_recency$
DECLARE
  r record;
  s text;
  n text;
  k integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- fn_lightning_form_hand: the small blind's key in the pool rows, the
    -- barrier's small blind, and the button's bookkeeping.
    (1, 'public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)',
     $a$'last_bb_at',      bo.last_bb_at,$a$,
     $a$'last_bb_at',      bo.last_bb_at,
           'hands_since_sb',  sl.hands_since_sb,$a$),
    (2, 'public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)',
     $a$ORDER BY ((t.e ->> 'player_id')::uuid = ANY (v_entry)), t.ord LIMIT 1;$a$,
     $a$ORDER BY ((t.e ->> 'player_id')::uuid = ANY (v_entry)),
             -- SMALL BLIND BY RECENCY (20261110): the most hands since a small blind.
             (t.e ->> 'hands_since_sb')::integer DESC,
             t.ord LIMIT 1;$a$),
    (3, 'public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)',
     $a$hands_since_sb = CASE WHEN sl.player_id = v_sb AND NOT (sl.player_id = ANY (v_entry)) THEN 0 ELSE sl.hands_since_sb + 1 END,$a$,
     $a$hands_since_sb = CASE WHEN sl.player_id = v_sb AND NOT (sl.player_id = ANY (v_entry)) THEN 0 ELSE sl.hands_since_sb + 1 END,
           hands_since_button = CASE WHEN sl.player_id = v_btn THEN 0 ELSE sl.hands_since_button + 1 END,$a$),
    -- fn_lightning_match_plan: the keys, the small blinds and P3.
    (4, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$coalesce(bl.btn_count, 0) AS btn, coalesce(bl.co_count, 0) AS co,$a$,
     $a$sl.hands_since_sb AS hss, sl.hands_since_button AS hsb, sl.last_button_at AS lbt,
           coalesce(bl.btn_count, 0) AS btn, coalesce(bl.co_count, 0) AS co,$a$),
    (5, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$'btn', k.btn, 'co', k.co, 'hj', k.hj, 'utg', k.utg)$a$,
     $a$'btn', k.btn, 'co', k.co, 'hj', k.hj, 'utg', k.utg,
            'hss', k.hss, 'hsb', k.hsb, 'lbt', k.lbt)$a$),
    (6, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$ORDER BY (u.pid = ANY (v_entry)), (v_info -> u.pid::text ->> 'p2')::integer LIMIT v_g);$a$,
     $a$ORDER BY (u.pid = ANY (v_entry)),
                  -- SMALL BLIND BY RECENCY (20261110): the most hands since a small blind.
                  (v_info -> u.pid::text ->> 'hss')::integer DESC,
                  (v_info -> u.pid::text ->> 'p2')::integer LIMIT v_g);$a$),
    (7, 'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)',
     $a$ORDER BY CASE WHEN v_p3 AND v_label IS NOT NULL THEN (v_info -> u.m::text ->> v_label)::integer ELSE 0 END,$a$,
     $a$-- P3 BY RECENCY (20261110): the most hands since the button, then the
       -- button held longest ago (never first); a full tie keeps queue order.
       ORDER BY CASE WHEN v_p3 THEN -(v_info -> u.m::text ->> 'hsb')::integer ELSE 0 END,
                CASE WHEN v_p3 THEN (v_info -> u.m::text ->> 'lbt')::timestamptz END ASC NULLS FIRST,$a$),
    -- fn_lightning_matcher_snapshot: the engine's model reads the same keys.
    (8, 'public.fn_lightning_matcher_snapshot(uuid,timestamp with time zone,uuid[],jsonb)',
     $a$'handsSinceBb',sl.hands_since_bb,$a$,
     $a$'handsSinceBb',sl.hands_since_bb,'handsSinceSb',sl.hands_since_sb,
   'handsSinceButton',sl.hands_since_button,'lastButtonAtMs',extract(epoch FROM sl.last_button_at)*1000,$a$),
    -- fn_lightning_instance_releases_its_reservations: a voided hand gives
    -- the button counter back as it gives back hands_since_sb.
    (9, 'public.fn_lightning_instance_releases_its_reservations()',
     $a$           hands_since_sb = CASE WHEN r.was_sb THEN r.dealt_since_sb
                                 ELSE GREATEST(sl.hands_since_sb - 1, 0) END,$a$,
     $a$           hands_since_sb = CASE WHEN r.was_sb THEN r.dealt_since_sb
                                 ELSE GREATEST(sl.hands_since_sb - 1, 0) END,
           hands_since_button = CASE WHEN r.was_btn THEN r.dealt_since_btn
                                     ELSE GREATEST(sl.hands_since_button - 1, 0) END,$a$),
    (10, 'public.fn_lightning_instance_releases_its_reservations()',
     $a$cnt.since_sb AS dealt_since_sb$a$,
     $a$cnt.since_sb AS dealt_since_sb,
                   cnt.since_btn AS dealt_since_btn$a$),
    (11, 'public.fn_lightning_instance_releases_its_reservations()',
     $a$(count(*) FILTER (WHERE prev.sb_at IS NULL OR d.formed_at > prev.sb_at))::integer AS since_sb$a$,
     $a$(count(*) FILTER (WHERE prev.sb_at IS NULL OR d.formed_at > prev.sb_at))::integer AS since_sb,
                       (count(*) FILTER (WHERE prev.btn_at IS NULL OR d.formed_at > prev.btn_at))::integer AS since_btn$a$)
  ) x(ord, sig, old_text, new_text) ORDER BY ord LOOP
    s := pg_get_functiondef(r.sig::regprocedure);
    k := (length(s) - length(replace(s, r.old_text, ''))) / length(r.old_text);
    IF k IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Lightning position fairness anchor % found % times in %; requalify before installing',
        r.ord, k, r.sig;
    END IF;
    n := replace(s, r.old_text, r.new_text);
    IF n = s THEN
      RAISE EXCEPTION 'Lightning position fairness anchor % did not change %', r.ord, r.sig;
    END IF;
    EXECUTE n;
  END LOOP;
END
$by_recency$;

COMMIT;
