-- 20261108171208_bust_backlog_storm_closes_with_its_exact_members
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 17:12:08 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- The bust detector resolved all 18 originals in a capped November 8
-- incident. The shared resolution trigger only handled capped finish
-- refusals, leaving the bust incident open. Reuse the same last-member
-- transition with exact, unique, same-source bust witnesses.
-- @live-proof: position('storm:financial_alerts:'' || NEW.source' IN pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure);
  old_scope constant text := $anchor$  IF NEW.source='Tournament.atomic_finish_refused' THEN
    FOR v_storm IN
      SELECT i.id,i.occurrences,i.detected_at FROM public.ca_drift_incidents i
      WHERE i.source='financial_alerts:Tournament.atomic_finish_refused'
        AND i.dedupe_key='storm:financial_alerts:Tournament.atomic_finish_refused'
        AND i.status<>'resolved' AND i.metadata->>'storm_member_version'='1'$anchor$;
  new_scope constant text := $anchor$  IF NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page') THEN
    FOR v_storm IN
      SELECT i.id,i.occurrences,i.detected_at FROM public.ca_drift_incidents i
      WHERE i.source='financial_alerts:' || NEW.source
        AND i.dedupe_key='storm:financial_alerts:' || NEW.source
        AND i.status<>'resolved'
        AND (NEW.source='fn_ca_bust_backlog_page' OR i.metadata->>'storm_member_version'='1')$anchor$;
  old_events constant text := $anchor$       WHERE e.incident_id=v_storm.id AND e.kind='recurred';$anchor$;
  new_events constant text := $anchor$       WHERE e.incident_id=v_storm.id AND e.kind='recurred'
      HAVING NEW.source <> 'fn_ca_bust_backlog_page'
          OR (count(DISTINCT a.id)=count(*)
            AND bool_and(COALESCE(e.detail->'financial_member_version'='1'::jsonb
                  AND e.detail->>'source'='financial_alerts:' || NEW.source,false)));$anchor$;
  old_reason constant text := 'The original tournament finish refusals were resolved by their authoritative financial alert transitions.';
  new_reason constant text := 'The original findings were resolved by their authoritative financial alert transitions.';
BEGIN
  IF cardinality(string_to_array(definition, old_scope)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(definition, old_events)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(definition, old_reason)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'BUST_BACKLOG_STORM_PREIMAGE_CHANGED';
  END IF;
  EXECUTE replace(replace(replace(definition, old_scope, new_scope),
    old_events, new_events), old_reason, new_reason);
END
$patch$;

-- The trigger now handles future final-member transitions. The original
-- cohort has already transitioned. Prove all 18 durable links before closing
-- this one incident, without re-opening any source alert.
DO $original$
DECLARE
  original public.ca_drift_incidents%ROWTYPE;
  member_count bigint;
  distinct_alerts bigint;
  all_resolved boolean;
BEGIN
  SELECT * INTO original FROM public.ca_drift_incidents
   WHERE id='a0f3b0ed-fce0-4f9a-b17f-31c25174af4a'
     AND source='financial_alerts:fn_ca_bust_backlog_page'
     AND dedupe_key='storm:financial_alerts:fn_ca_bust_backlog_page'
     AND status='open'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*),count(DISTINCT a.id),
         bool_and(COALESCE(a.resolved AND a.source='fn_ca_bust_backlog_page'
           AND e.detail->'financial_member_version'='1'::jsonb
           AND e.detail->>'source'=original.source,false))
    INTO member_count,distinct_alerts,all_resolved
    FROM public.ca_incident_events e
    LEFT JOIN public.financial_alerts a ON a.id=CASE
      WHEN e.detail->>'alert_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (e.detail->>'alert_id')::uuid END
   WHERE e.incident_id=original.id AND e.kind='recurred';

  IF original.occurrences=18 AND member_count=18 AND distinct_alerts=18 AND all_resolved THEN
    UPDATE public.ca_drift_incidents
       SET status='resolved',resolved_at=GREATEST(now(),detected_at),
           closure_basis='verified_remeasured',
           root_cause='The capped bust backlog was outside the financial alert resolution trigger''s supported sources.',
           correction_ref='verified: all 18 exact original bust alerts resolved by their producer',
           resolution='Closed after proving the complete set of exact original source alert resolutions.'
     WHERE id=original.id AND status='open';
  END IF;
END
$original$;

COMMIT;
