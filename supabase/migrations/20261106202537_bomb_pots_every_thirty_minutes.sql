-- 20261106202537_bomb_pots_every_thirty_minutes.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Owner direction, 2026-11-06: "FOR BOMB POTS, LETS CHANGE IT SO THE SPINNING
-- WHEEL ONLY APPEARS EVERY 30 MINUTES. SO 2 BOMB POTS AN HOUR."
--
-- The wheel is the timed scheduler's announce: inside the last three minutes
-- of a timed interval the clock becomes "BOMB POT IN 1-5 HANDS" and the wheel
-- reveals the count (BombPotScheduler.TIMED_ARM_WINDOW_MS, BombPotWheel). So
-- one wheel per bomb, and the interval is the whole rule: every cash game
-- with bomb pots on now runs them every thirty minutes (1800 s), Lightning
-- and must-move alike, every variant. Supersedes the 2026-10-28 PLO twelve
-- minute and the NLH ten minute cadences.
--
-- Existing engines read configuration at hand boundaries; no restart needed.
-- Preserves already armed/owed bombs and scheduler state, Classic no-bomb
-- rules, antes, boards and all money. Each installed function image is
-- guarded by md5; concurrent source drift refuses the migration.
-- @live-proof: (public.fn_cash_template_defaults('madness','plo5')->'bombs'->>'trigger') = 'timed_30m' AND (public.fn_cash_template_defaults('madness','nlh')->'bombs'->>'trigger') = 'timed_30m'
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE p jsonb; e jsonb; s text; n text; anchor text;
BEGIN
 FOR p IN SELECT * FROM jsonb_array_elements($patches$[
  {
    "fn": "public.fn_cash_template_defaults(text,text)",
    "md5": "c96566a6be0c309d5fc9eb894dcfa8f2",
    "edits": [
      [
        "CASE WHEN t='classic' THEN NULL WHEN v IN ('plo4','plo5','plo6','plo8') THEN 'timed_12m' ELSE 'timed_10m' END",
        "CASE WHEN t='classic' THEN NULL ELSE 'timed_30m' END"
      ]
    ]
  },
  {
    "fn": "public.fn_cash_game_create_impl_20260905(uuid,text,text,numeric,numeric,integer,jsonb,text,boolean)",
    "md5": "9f89523d1d2ed2c702440a6a30e89e95",
    "edits": [
      [
        "'timed_10m', 'timed_12m', 'timed_15m', 'timed_20m', 'every_orbit'",
        "'timed_10m', 'timed_12m', 'timed_15m', 'timed_20m', 'timed_30m', 'every_orbit'"
      ]
    ]
  },
  {
    "fn": "public.fn_cash_cluster_open_table(uuid,text,integer,text,uuid)",
    "md5": "bd7656cc81b46fcd4fe7220e96ffab6d",
    "edits": [
      [
        "'timed_10m', 'timed_12m', 'timed_15m', 'timed_20m')",
        "'timed_10m', 'timed_12m', 'timed_15m', 'timed_20m', 'timed_30m')"
      ],
      [
        "WHEN v_bomb_trigger = 'timed_12m' THEN 720",
        "WHEN v_bomb_trigger = 'timed_30m' THEN 1800\n         WHEN v_bomb_trigger = 'timed_12m' THEN 720"
      ]
    ]
  },
  {
    "fn": "public.fn_cash_apply_ruleset(uuid)",
    "md5": "5d2921bd0675748d67f639f9719e9f02",
    "edits": [
      [
        "'timed_10m', 'timed_12m', 'timed_15m', 'timed_20m')",
        "'timed_10m', 'timed_12m', 'timed_15m', 'timed_20m', 'timed_30m')"
      ],
      [
        "WHEN v_bomb_trigger = 'timed_12m' THEN 720",
        "WHEN v_bomb_trigger = 'timed_30m' THEN 1800\n                     WHEN v_bomb_trigger = 'timed_12m' THEN 720"
      ]
    ]
  }
]$patches$::jsonb) LOOP
  s := pg_get_functiondef((p->>'fn')::regprocedure);
  IF md5(s) IS DISTINCT FROM p->>'md5' THEN
   RAISE EXCEPTION 'BOMB_30_SOURCE_CHANGED: %', p->>'fn';
  END IF;
  n := s;
  FOR e IN SELECT * FROM jsonb_array_elements(p->'edits') LOOP
   anchor := e->>0;
   IF (length(n)-length(replace(n,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION 'BOMB_30_ANCHOR_CHANGED: %',p->>'fn';
   END IF;
   n := replace(n,anchor,e->>1);
  END LOOP;
  EXECUTE n;
 END LOOP;
END $patch$;

-- Every open, non-retired game with bombs on receives the thirty minute
-- promise, whatever cadence it carried. Classic (bombs off) is untouched.
UPDATE public.cash_games g
 SET ruleset_snapshot=jsonb_set(g.ruleset_snapshot,'{bombs,trigger}','"timed_30m"'::jsonb),
     updated_at=now()
 FROM public.clubs c
 WHERE c.id=g.club_id AND coalesce(c.lifecycle_status,'')<>'retired'
   AND g.closed_at IS NULL
   AND (g.ruleset_snapshot->'bombs'->>'enabled')::boolean
   AND g.ruleset_snapshot->'bombs'->>'trigger' IS DISTINCT FROM 'timed_30m';

-- Project only cadence columns; do not rewrite other rules or scheduler state.
UPDATE public.tables t SET bomb_pot_trigger_mode='timed',
 bomb_pot_interval_seconds=1800,updated_at=now()
 FROM public.cash_games g JOIN public.clubs c ON c.id=g.club_id
 WHERE t.cluster_id=g.id AND coalesce(c.lifecycle_status,'')<>'retired'
 AND g.closed_at IS NULL
 AND g.ruleset_snapshot->'bombs'->>'trigger'='timed_30m'
 AND (g.ruleset_snapshot->'bombs'->>'enabled')::boolean
 AND t.lifecycle<>'closed' AND NOT coalesce(t.is_deleted,false)
 AND (t.bomb_pot_trigger_mode IS DISTINCT FROM 'timed'
      OR t.bomb_pot_interval_seconds IS DISTINCT FROM 1800);

DO $verify$
DECLARE v text;
BEGIN
 -- Lightning (madness) templates exist for these variants only; the rest
 -- are Classic-only and fn_cash_template_defaults refuses them as madness.
 FOREACH v IN ARRAY ARRAY['nlh','plo4','plo5','plo6','flh'] LOOP
  IF public.fn_cash_template_defaults('madness',v)->'bombs'->>'trigger' IS DISTINCT FROM 'timed_30m' THEN
   RAISE EXCEPTION 'BOMB_30_DEFAULT_FAILED: %',v;
  END IF;
 END LOOP;
 FOREACH v IN ARRAY ARRAY['nlh','plo4','plo5','plo6','plo8','flh','flo8','short_deck','pineapple'] LOOP
  IF public.fn_cash_template_defaults('classic',v)->'bombs'->>'enabled' IS DISTINCT FROM 'false' THEN
   RAISE EXCEPTION 'BOMB_30_CLASSIC_CHANGED: %',v;
  END IF;
 END LOOP;
 IF EXISTS (
  SELECT 1 FROM public.cash_games g JOIN public.clubs c ON c.id=g.club_id
  LEFT JOIN public.tables t ON t.cluster_id=g.id AND t.lifecycle<>'closed' AND NOT coalesce(t.is_deleted,false)
  WHERE coalesce(c.lifecycle_status,'')<>'retired' AND g.closed_at IS NULL
  AND (g.ruleset_snapshot->'bombs'->>'enabled')::boolean
  AND (g.ruleset_snapshot->'bombs'->>'trigger' IS DISTINCT FROM 'timed_30m'
   OR (t.id IS NOT NULL AND (t.bomb_pot_trigger_mode IS DISTINCT FROM 'timed'
     OR t.bomb_pot_interval_seconds IS DISTINCT FROM 1800)))
 ) THEN RAISE EXCEPTION 'BOMB_30_PROJECTION_FAILED'; END IF;
END $verify$;
COMMIT;
