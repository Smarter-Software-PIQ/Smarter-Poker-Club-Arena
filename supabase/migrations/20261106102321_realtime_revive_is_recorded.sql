-- 20261106102321_realtime_revive_is_recorded
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-06 10:23:21 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- WHAT WAS WRONG. #9645 (2026-11-05) made a dead realtime socket get found the
-- moment a player returns to the page (src/lib/realtimeLiveness.ts): a page
-- that is shown again probes the socket and forces a reconnect when it is
-- dead, so tournament broadcasts (knockouts, levels, breaks, chests) stop
-- vanishing for up to 50 s after a phone wakes. It reported each forced
-- reconnect through reportWarning, which only writes to the browser console.
-- Production therefore had no record that the fix ever fired: read on
-- 2026-11-06 10:20 UTC, zero 'resume_revived' rows anywhere, while
-- client_error_events kept filing 'Realtime transport lost' at the old rate.
-- That rate cannot fall by design: a forced reconnect on resume fans out as a
-- visible channel error exactly like an organic drop. The measures that can
-- prove the fix are how often a revive happens and how long the page waited
-- from coming back to having its channels joined again.
--
-- WHAT THIS CHANGES. One insert-only table, client_realtime_revivals: one row
-- per forced reconnect (rate limited on the client to one per ten minutes),
-- with the reason, the probe wait and the measured resume-to-rejoin gap, or
-- rejoined = false when no channel joined within two minutes. Signed-in
-- players insert only their own rows (RLS user_id = auth.uid()); nobody but
-- service_role reads them. v_realtime_revival_daily answers the KPI: revives
-- per day and reason, rejoin share, and gap p50/p95/max.
--
-- It is telemetry, not money: no chips, balances or ledgers are read or
-- written. Nothing existing is altered.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$ BEGIN
  IF to_regclass('public.client_realtime_revivals') IS NOT NULL
     OR to_regclass('public.v_realtime_revival_daily') IS NOT NULL THEN
    RAISE EXCEPTION 'client_realtime_revivals already installed';
  END IF;
END $pre$;

CREATE TABLE public.client_realtime_revivals(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('not_connected', 'unanswered_heartbeat')),
  rejoined boolean NOT NULL,
  gap_ms integer CHECK (gap_ms IS NULL OR (gap_ms >= 0 AND gap_ms <= 600000)),
  waited_ms integer CHECK (waited_ms IS NULL OR (waited_ms >= 0 AND waited_ms <= 600000)),
  route text CHECK (route IS NULL OR length(route) <= 200),
  app_version text CHECK (app_version IS NULL OR length(app_version) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rejoined = (gap_ms IS NOT NULL)));
COMMENT ON TABLE public.client_realtime_revivals IS
 'One row per realtime socket the client forced back on page resume (src/lib/realtimeLiveness.ts, 2026-11-06): reason, probe wait and resume-to-rejoin gap. Insert-only for the signed-in player; read by service_role only. Telemetry; moves nothing.';
CREATE INDEX client_realtime_revivals_created_at_idx ON public.client_realtime_revivals (created_at);

ALTER TABLE public.client_realtime_revivals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_realtime_revivals FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT (user_id, reason, rejoined, gap_ms, waited_ms, route, app_version)
  ON public.client_realtime_revivals TO authenticated;
GRANT SELECT ON public.client_realtime_revivals TO service_role;
CREATE POLICY client_realtime_revivals_insert_own ON public.client_realtime_revivals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE VIEW public.v_realtime_revival_daily
WITH (security_invoker = true) AS
SELECT date_trunc('day', r.created_at) AS day,
       r.reason,
       count(*) AS revives,
       count(*) FILTER (WHERE r.rejoined) AS rejoined,
       count(DISTINCT r.user_id) AS players,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY r.gap_ms) AS gap_p50_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY r.gap_ms) AS gap_p95_ms,
       max(r.gap_ms) AS gap_max_ms
  FROM public.client_realtime_revivals r
 GROUP BY 1, 2;
COMMENT ON VIEW public.v_realtime_revival_daily IS
 'Daily realtime revive KPI: forced reconnects on resume per reason, how many rejoined, players, and the resume-to-rejoin gap p50/p95/max in ms.';
REVOKE ALL ON public.v_realtime_revival_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_realtime_revival_daily TO service_role;

COMMIT;
