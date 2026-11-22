-- 20261119211558_a_hand_for_hand_wait_is_an_owed_wait.sql
--
-- WHAT THIS CHANGES, AND WHY (incident 1e532243, fn_ca_hand_gap_watch):
--
-- At 21:11 UTC on 2026-11-19 the watch opened a critical "unintended delay
-- between hands" for tournament all_in_showdown, p95 8,998 ms after a
-- 34,387 ms window. Every slow hand was one tournament, "Satellite Into Union
-- Grand Championship (NLH)" (2b6af0b0), and the engine log for that minute is:
--
--   HAND-FOR-HAND - 19 players, paid through place 18
--   Hand-for-hand: all 3 tables done - resuming for next hand   (x9)
--   BUBBLE BURST - 18 players ITM
--
-- Hand-for-hand on the money bubble is a rule of the game, not a delay: each
-- table deals its next hand only when every table has finished the current
-- one (TournamentManagerEliminations, startHandForHandSync). The grader
-- already leaves out the intended waits it can see (Lightning, a maintenance
-- break, a tournament break); hand-for-hand was invisible to it because the
-- engine kept it only in memory.
--
-- 1. ca_tournament_hand_for_hand records each hand-for-hand interval of a
--    tournament: the engine writes the start when it arms the barrier and the
--    end when it stops it (fn_ca_note_hand_for_hand, service_role only,
--    fire-and-forget from TournamentManagerBase, never on the deal path).
-- 2. fn_ca_hand_gap_unintended_delay leaves out a pair whose wait overlaps a
--    recorded interval of its own tournament, exactly as it leaves out a
--    tournament break. Every other hand is graded as before.
--
-- The grader is redefined by an anchored edit of production's own text; the
-- anchor must match once. Pinned by
-- tests/a-hand-for-hand-wait-is-an-owed-wait.law.test.ts.

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS public.ca_tournament_hand_for_hand (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  PRIMARY KEY (tournament_id, started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS ca_tournament_hand_for_hand_one_open
  ON public.ca_tournament_hand_for_hand (tournament_id) WHERE ended_at IS NULL;
ALTER TABLE public.ca_tournament_hand_for_hand ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_tournament_hand_for_hand FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ca_tournament_hand_for_hand TO service_role;
COMMENT ON TABLE public.ca_tournament_hand_for_hand IS
  'Hand-for-hand (money bubble) intervals per tournament, written by the engine. An intended wait between hands; fn_ca_hand_gap_unintended_delay does not grade it (incident 1e532243).';

CREATE OR REPLACE FUNCTION public.fn_ca_note_hand_for_hand(p_tournament_id uuid, p_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
 SET lock_timeout TO '2s'
AS $function$
BEGIN
  IF p_tournament_id IS NULL OR p_active IS NULL THEN
    RETURN false;
  END IF;
  IF p_active THEN
    INSERT INTO public.ca_tournament_hand_for_hand (tournament_id, started_at)
    VALUES (p_tournament_id, clock_timestamp())
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.ca_tournament_hand_for_hand
       SET ended_at = clock_timestamp()
     WHERE tournament_id = p_tournament_id AND ended_at IS NULL;
  END IF;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_note_hand_for_hand(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_note_hand_for_hand(uuid, boolean) TO service_role;

DO $edit$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone, integer)'::regprocedure);
  c_old constant text := 'AND NOT EXISTS (SELECT 1 FROM tournaments t';
  c_new constant text := 'AND NOT EXISTS (SELECT 1 FROM ca_tournament_hand_for_hand h4h'
    || chr(10) || '                      WHERE h4h.tournament_id = p.tournament_id AND h4h.started_at < nx.started_at'
    || chr(10) || '                        AND COALESCE(h4h.ended_at, ''infinity'') > p.ended_at)'
    || chr(10) || '     AND NOT EXISTS (SELECT 1 FROM tournaments t';
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay tournament-break anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

-- @probe-for: public.fn_ca_note_hand_for_hand
-- @probe-for: public.fn_ca_hand_gap_unintended_delay
DO $probe$
DECLARE v_t uuid; v_n int;
BEGIN
  SELECT id INTO v_t FROM public.tournaments ORDER BY created_at DESC LIMIT 1;
  IF v_t IS NOT NULL THEN
    PERFORM public.fn_ca_note_hand_for_hand(v_t, true);
    PERFORM public.fn_ca_note_hand_for_hand(v_t, false);
  END IF;
  SELECT count(*) INTO v_n FROM public.fn_ca_hand_gap_unintended_delay(now(), 5);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
