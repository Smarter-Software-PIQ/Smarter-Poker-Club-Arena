-- 20261108185135_versioned_original_alerts_close_their_own_incident
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 18:51:35 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.

-- A producer refreshes the same alert's message and error as conditions change.
-- For two satellite boundary groups, the refreshed text no longer hashed to
-- the incident's original key, even though the exact event links were intact.
-- Use those links for versioned originals and keep legacy text matching.
-- @live-proof: position('versioned_membership_survives_alert_refresh' IN pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure);
  old_selection constant text := $old$      AND i.dedupe_key='fa:' || NEW.source || ':' || md5(public.fn_ca_normalize_alert_text(left(NEW.message,200)) || '|' || public.fn_ca_normalize_alert_text(left(COALESCE(NEW.context->>'error',''),200)))
    ORDER BY i.id FOR UPDATE$old$;
  new_selection constant text := $new$      AND (i.dedupe_key='fa:' || NEW.source || ':' || md5(public.fn_ca_normalize_alert_text(left(NEW.message,200)) || '|' || public.fn_ca_normalize_alert_text(left(COALESCE(NEW.context->>'error',''),200)))
        -- versioned_membership_survives_alert_refresh
        OR (right(i.dedupe_key,32) ~ '^[0-9a-f]{32}$'
          AND i.dedupe_key='fa:' || NEW.source || ':' || right(i.dedupe_key,32)
          AND EXISTS(SELECT 1 FROM public.ca_incident_events e
            WHERE e.incident_id=i.id AND e.kind IN ('created','recurred')
              AND e.detail->'financial_member_version'='1'::jsonb
              AND e.detail->>'source'=i.source AND lower(e.detail->>'alert_id')=NEW.id::text)))
    ORDER BY i.id FOR UPDATE$new$;
  old_count constant text := $old$           COALESCE(bool_or(current_member),false)
      INTO v_members,v_bad,v_current FROM members;$old$;
  new_count constant text := $new$           COALESCE(bool_or(current_member),false)
      INTO v_members,v_bad,v_current FROM members
    HAVING count(*) FILTER (WHERE detail ? 'financial_member_version')
         = count(DISTINCT lower(detail->>'alert_id')) FILTER (WHERE detail ? 'financial_member_version');$new$;
BEGIN
  IF cardinality(string_to_array(definition,old_selection)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(definition,old_count)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'VERSIONED_FINANCIAL_INCIDENT_PREIMAGE_CHANGED';
  END IF;
  EXECUTE replace(replace(definition,old_selection,new_selection),old_count,new_count);
END $patch$;

DO $original$
DECLARE
  expected record;
  original public.ca_drift_incidents%ROWTYPE;
  member_count bigint;
  distinct_alerts bigint;
  all_resolved boolean;
BEGIN
  -- Either group's receipt can arrive while this migration is in flight.
  FOR expected IN SELECT * FROM (VALUES
    ('97937ff2-fcad-42ba-9a92-0c004626dec7'::uuid,2),
    ('a7359e4a-062d-4f4b-b203-56e20a6e90a7'::uuid,1)
  ) AS groups(id,occurrences)
  LOOP
    SELECT * INTO original FROM public.ca_drift_incidents
     WHERE id=expected.id
       AND source='financial_alerts:Tournament.satellite_boundary_held' AND status<>'resolved';
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'ca-financial-incident-members:' || public.fn_ca_stable_dedupe_key(original.dedupe_key),0));
    SELECT * INTO original FROM public.ca_drift_incidents
     WHERE id=expected.id AND status<>'resolved' FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT count(*),count(DISTINCT a.id),
           bool_and(COALESCE(e.detail->'financial_member_version'='1'::jsonb
             AND e.detail->>'source'=original.source
             AND a.source='Tournament.satellite_boundary_held' AND a.resolved
             AND t.status='COMPLETED' AND t.current_players=0
             AND e_escrow.prize_balance=0 AND e_escrow.bounty_balance=0 AND e_escrow.fee_balance=0
             AND s.receipt_version=3 AND s.settled_at>=a.created_at
             AND s.source_escrow_closed_at=e_escrow.terminal_closed_at
             AND s.pool=t.prize_pool AND cardinality(s.qualifier_ids)>0,false))
      INTO member_count,distinct_alerts,all_resolved
      FROM public.ca_incident_events e
      LEFT JOIN public.financial_alerts a ON a.id=CASE
        WHEN e.detail->>'alert_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (e.detail->>'alert_id')::uuid END
      LEFT JOIN public.tournaments t ON t.id=CASE
        WHEN a.context->>'tournament_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (a.context->>'tournament_id')::uuid END
      LEFT JOIN public.tournament_escrow e_escrow ON e_escrow.tournament_id=t.id
      LEFT JOIN public.tournament_satellite_settlements s ON s.tournament_id=t.id
     WHERE e.incident_id=original.id AND e.kind IN ('created','recurred');

    IF original.occurrences=expected.occurrences AND member_count=expected.occurrences
       AND distinct_alerts=expected.occurrences AND all_resolved THEN
      UPDATE public.ca_drift_incidents
         SET status='resolved',resolved_at=GREATEST(now(),detected_at),
             closure_basis='verified_remeasured',
             correction_ref='verified: original boundary alerts resolved from terminal settlement receipts',
             root_cause='A refresh of the original alert message changed its hash while its versioned incident membership stayed intact.',
             resolution='Verified all exact original boundary alerts resolved from their terminal settlement receipts.'
       WHERE id=original.id AND status<>'resolved';
    END IF;
  END LOOP;
END $original$;

COMMIT;
