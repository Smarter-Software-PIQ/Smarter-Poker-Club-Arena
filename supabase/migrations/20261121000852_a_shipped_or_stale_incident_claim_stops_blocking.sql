-- 20261121000852_a_shipped_or_stale_incident_claim_stops_blocking.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A SHIPPED OR STALE INCIDENT CLAIM STOPS BLOCKING (2026-11-20).
--
-- WHAT HAPPENED. Incident 1e532243 (money_integrity, fn_ca_hand_gap_watch) was
-- claimed at 2026-11-19 17:56 UTC by one lane with PR #11520. The PR merged at
-- 2026-11-20 16:51:36 UTC. The incident recurred at 17:51 (a residual
-- all_in_showdown cause) and refired five more times by 22:56, and every
-- reminder said "claimed by ... Coordinate with that owner; do not start a
-- second fix." The owner kept renewing (expires_at pushed to 2026-11-21 16:54)
-- with the same branch and PR and did no further work, so no lane could act
-- for hours. Two defects in 20261118191706 made that possible:
--
--   1. A claim never learned that its PR had shipped. A merged fix followed by
--      a fresh firing means the claimed work is finished and did not cure the
--      incident, yet the claim still blocked every other lane.
--   2. Renewal had no bound. Each call with p_ttl <= 24 hours pushed
--      expires_at out again, with no evidence of progress required, so a claim
--      could be held for ever.
--
-- THE FIX, at the claim itself (nothing here watches, sweeps or repairs):
--
--   * A claim records progress_at: when it was taken, or when its holder last
--     reported a CHANGED branch or pull request. A claim blocks other lanes for
--     at most 8 hours after progress_at (CLAIM LIFETIME). expires_at is capped
--     at progress_at + 8 hours on every claim and renewal, and a holder whose
--     lifetime is spent cannot renew (or re-take an expired claim) without a
--     new branch or PR. Why 8 hours: the 10.88 convention is a 4-hour claim
--     renewed with the same call, so 8 hours is two full terms of work with no
--     visible change; a lane that is actually progressing opens a branch and
--     then a PR inside that time, and each of those restarts the lifetime.
--     The old 24-hour p_ttl ceiling is kept as input validation, so existing
--     callers keep working; a longer p_ttl is simply clamped.
--   * A claim records pr_merged_at, the moment its PR merged. When a claim
--     whose PR has merged sees the incident fire again AFTER that merge (a
--     'recurrence' or 'refire' event on reliability_incident_events, the
--     controller's own record that the alert came back after resolving), the
--     claim no longer blocks: "the claimed fix shipped and the incident
--     recurred". Continuous firing that never resolved is not a recurrence, so
--     a merged fix still waiting to go live is not superseded by the very
--     firing it is about to cure.
--   * WHERE THE MERGE TIME COMES FROM. No table in this database records pull
--     request merges (ca_merged_migration_watch records migration files only,
--     without PR numbers). The source of truth is GitHub, and the database
--     already reads it through smarter_private.ca_cutover_http_json (8 s
--     timeout, NULL when it cannot tell). The claim function asks GitHub ONLY
--     when another lane is refused by a claim that names a PR with no recorded
--     merge, and BEFORE it takes any row lock, so the controller tick and the
--     escalation renderer never make a network call and a hung GitHub never
--     holds a lock. GitHub unreadable is UNKNOWN (CLAUDE.md 10.86): the claim
--     keeps blocking, and the 8-hour lifetime still bounds it. PR forms read:
--     "#123", "123", and https://github.com/<owner>/<repo>/pull/<n>.
--   * A superseded claim is never silently deleted. A takeover of an existing
--     claim (expired, lifetime spent, or shipped and recurred) appends a
--     'claim_superseded' event to the append-only reliability_incident_events
--     with the reason, the full previous claim row and the new owner.
--   * The handoff names which of these states the claim is in, and an
--     unblocked reader is told to claim it, with the shipped PR named so the
--     next lane first checks whether that fix is already live.
--
-- Rows already in the table get progress_at = claimed_at (the only progress
-- time recorded), so the 1e532243 claim, held since 2026-11-19 17:56 with no
-- new branch or PR, stops blocking as soon as this installs. No claim row is
-- edited by hand; the column backfill is the only write to existing rows.
--
-- Native proof: scripts/ci/qualify-reliability-incident-claims.py, loaded by
-- scripts/ci/test-reliability-controller-stage-b.py (PostgreSQL, never
-- production). Pinned by tests/a-shipped-or-stale-incident-claim-stops-blocking.law.test.ts.
--
-- @live-proof: (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'reliability_incident_claims' AND column_name IN ('progress_at', 'pr_merged_at')) = 2 AND strpos(pg_get_functiondef('smarter_private.reliability_render_escalation(uuid,text,bigint)'::regprocedure), 'reliability_claim_owner_line(i.id)') > 0 AND strpos(pg_get_functiondef('smarter_private.fn_claim_reliability_incident(uuid,text,text,text,interval)'::regprocedure), 'claim_superseded') > 0 AND NOT has_function_privilege('authenticated', 'smarter_private.fn_claim_reliability_incident(uuid,text,text,text,interval)', 'EXECUTE')

BEGIN;

SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. The claim remembers when it last progressed and when its PR merged.
-- ---------------------------------------------------------------------------
ALTER TABLE smarter_private.reliability_incident_claims
  ADD COLUMN IF NOT EXISTS progress_at timestamptz,
  ADD COLUMN IF NOT EXISTS pr_merged_at timestamptz;
UPDATE smarter_private.reliability_incident_claims SET progress_at = claimed_at WHERE progress_at IS NULL;
ALTER TABLE smarter_private.reliability_incident_claims
  ALTER COLUMN progress_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN progress_at SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Reading a pull request's merge time from GitHub. NULL = not merged, or
--    could not tell; both keep the claim as it is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_claim_pr_api_url(p_pull_request text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN btrim(p_pull_request) ~ '^#?[0-9]{1,9}$'
      THEN 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/'
           || ltrim(btrim(p_pull_request), '#')
    WHEN btrim(p_pull_request) ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]{1,9}([/?#].*)?$'
      THEN regexp_replace(btrim(p_pull_request),
             '^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/pull/([0-9]{1,9}).*$',
             'https://api.github.com/repos/\1/\2/pulls/\3')
  END
$function$;
REVOKE ALL ON FUNCTION smarter_private.reliability_claim_pr_api_url(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION smarter_private.reliability_claim_pr_merged_at(p_pull_request text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  v_url text := smarter_private.reliability_claim_pr_api_url(p_pull_request);
  v_pr jsonb;
BEGIN
  IF v_url IS NULL OR to_regprocedure('smarter_private.ca_cutover_http_json(text)') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT smarter_private.ca_cutover_http_json($1)' INTO v_pr USING v_url;
  RETURN nullif(v_pr->>'merged_at', '')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.reliability_claim_pr_merged_at(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. One definition of whether a claim blocks, shared by the claim function
--    and the handoff so the two can never disagree.
--      none | live | expired | lifetime_spent | shipped_and_recurred
--    Only 'live' blocks another lane.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_incident_claim_state(
  p_incident_id uuid, p_at timestamptz DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  c_lifetime constant interval := interval '8 hours';
  k smarter_private.reliability_incident_claims;
  v_refired timestamptz;
BEGIN
  SELECT * INTO k FROM smarter_private.reliability_incident_claims WHERE incident_id = p_incident_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none');
  END IF;
  IF k.pr_merged_at IS NOT NULL THEN
    SELECT min(e.at) INTO v_refired
      FROM smarter_private.reliability_incident_events e
     WHERE e.incident_id = p_incident_id
       AND e.kind IN ('recurrence', 'refire')
       AND e.at > k.pr_merged_at;
  END IF;
  RETURN jsonb_build_object(
    'state', CASE WHEN v_refired IS NOT NULL THEN 'shipped_and_recurred'
                  WHEN p_at >= k.progress_at + c_lifetime THEN 'lifetime_spent'
                  WHEN k.expires_at <= p_at THEN 'expired'
                  ELSE 'live' END,
    'refired_after_merge_at', v_refired,
    'lifetime_ends_at', k.progress_at + c_lifetime);
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.reliability_incident_claim_state(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The claim. Same signature and the same answers for a fresh claim, a
--    renewal and a refusal; it now also bounds renewal by progress and lets a
--    shipped-and-recurred claim be superseded on the record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.fn_claim_reliability_incident(
  p_incident_id uuid, p_agent_session text, p_branch text DEFAULT NULL,
  p_pull_request text DEFAULT NULL, p_ttl interval DEFAULT interval '4 hours')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  c_lifetime constant interval := interval '8 hours';
  v_session text := nullif(btrim(p_agent_session), '');
  v_branch text := nullif(btrim(p_branch), '');
  v_pr text := nullif(btrim(p_pull_request), '');
  v_now timestamptz := clock_timestamp();
  k smarter_private.reliability_incident_claims;
  v_seen smarter_private.reliability_incident_claims;
  v_merged timestamptz;
  v_asked_github boolean := false;
  v_state jsonb;
  v_branch_changed boolean;
  v_pr_changed boolean;
  v_new_pr text;
  v_claimed boolean := false;
  v_renewed boolean := false;
  v_reason text;
BEGIN
  IF p_incident_id IS NULL OR v_session IS NULL THEN
    RAISE EXCEPTION 'incident_claim_identity_missing' USING ERRCODE = '22023';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '24 hours' THEN
    RAISE EXCEPTION 'incident_claim_ttl_out_of_range' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Ask GitHub before any lock, and only when another lane's otherwise live
  -- claim names a PR whose merge is not recorded yet.
  SELECT * INTO v_seen FROM smarter_private.reliability_incident_claims WHERE incident_id = p_incident_id;
  IF FOUND AND v_seen.agent_session <> v_session AND v_seen.pull_request IS NOT NULL
     AND v_seen.pr_merged_at IS NULL AND v_seen.expires_at > v_now
     AND v_now < v_seen.progress_at + c_lifetime THEN
    v_asked_github := true;
    v_merged := smarter_private.reliability_claim_pr_merged_at(v_seen.pull_request);
  END IF;

  INSERT INTO smarter_private.reliability_incident_claims AS c
         (incident_id, agent_session, branch, pull_request, claimed_at, progress_at, expires_at)
  VALUES (p_incident_id, v_session, v_branch, v_pr, v_now, v_now, v_now + least(p_ttl, c_lifetime))
  ON CONFLICT (incident_id) DO NOTHING
  RETURNING c.* INTO k;

  IF FOUND THEN
    v_claimed := true;
    v_reason := 'claimed';
  ELSE
    SELECT * INTO STRICT k FROM smarter_private.reliability_incident_claims
     WHERE incident_id = p_incident_id FOR UPDATE;
    IF v_merged IS NOT NULL AND k.pr_merged_at IS NULL
       AND k.pull_request IS NOT DISTINCT FROM v_seen.pull_request THEN
      UPDATE smarter_private.reliability_incident_claims SET pr_merged_at = v_merged
       WHERE incident_id = p_incident_id RETURNING * INTO k;
    END IF;
    v_state := smarter_private.reliability_incident_claim_state(p_incident_id, v_now);
    v_branch_changed := v_branch IS NOT NULL AND v_branch IS DISTINCT FROM k.branch;
    v_pr_changed := v_pr IS NOT NULL AND v_pr IS DISTINCT FROM k.pull_request;

    IF k.agent_session = v_session THEN
      IF v_branch_changed OR v_pr_changed THEN
        -- Progress: a new branch or PR restarts the lifetime. A new branch
        -- without a PR drops a PR that already merged (that work is done).
        v_new_pr := CASE WHEN v_pr IS NOT NULL THEN v_pr
                         WHEN k.pr_merged_at IS NOT NULL THEN NULL
                         ELSE k.pull_request END;
        UPDATE smarter_private.reliability_incident_claims
           SET branch       = coalesce(v_branch, k.branch),
               pull_request = v_new_pr,
               pr_merged_at = CASE WHEN v_new_pr IS NOT DISTINCT FROM k.pull_request THEN k.pr_merged_at END,
               claimed_at   = CASE WHEN k.expires_at > v_now THEN k.claimed_at ELSE v_now END,
               progress_at  = v_now,
               expires_at   = v_now + least(p_ttl, c_lifetime)
         WHERE incident_id = p_incident_id RETURNING * INTO k;
        v_claimed := smarter_private.reliability_incident_claim_state(p_incident_id, v_now)->>'state' = 'live';
        v_renewed := true;
        v_reason := 'renewed_with_progress';
      ELSIF v_state->>'state' IN ('lifetime_spent', 'shipped_and_recurred') THEN
        v_claimed := false;
        v_reason := (v_state->>'state') || '_renewal_needs_a_new_branch_or_pull_request';
      ELSE
        UPDATE smarter_private.reliability_incident_claims
           SET claimed_at = CASE WHEN k.expires_at > v_now THEN k.claimed_at ELSE v_now END,
               expires_at = least(v_now + p_ttl, k.progress_at + c_lifetime)
         WHERE incident_id = p_incident_id RETURNING * INTO k;
        v_claimed := true;
        v_renewed := true;
        v_reason := 'renewed';
      END IF;
    ELSIF v_state->>'state' = 'live' THEN
      v_claimed := false;
      v_reason := 'held_by_another_lane';
    ELSE
      -- The previous claim no longer blocks. Record it, then take over.
      INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail, at)
      VALUES (p_incident_id, 'claim_superseded',
              jsonb_build_object('kind', 'claim_superseded', 'reason', v_state->>'state',
                                 'refired_after_merge_at', v_state->'refired_after_merge_at',
                                 'previous', to_jsonb(k), 'superseded_by', v_session), v_now);
      UPDATE smarter_private.reliability_incident_claims
         SET agent_session = v_session, branch = v_branch, pull_request = v_pr, pr_merged_at = NULL,
             claimed_at = v_now, progress_at = v_now, expires_at = v_now + least(p_ttl, c_lifetime)
       WHERE incident_id = p_incident_id RETURNING * INTO k;
      v_claimed := true;
      v_reason := 'superseded_' || (v_state->>'state');
    END IF;
  END IF;

  v_state := smarter_private.reliability_incident_claim_state(p_incident_id, v_now);
  RETURN jsonb_build_object(
    'claimed', v_claimed, 'renewed', v_renewed, 'reason', v_reason,
    'state', v_state->>'state',
    'incident_id', k.incident_id, 'owner', k.agent_session,
    'branch', k.branch, 'pull_request', k.pull_request,
    'claimed_at', k.claimed_at, 'progress_at', k.progress_at, 'expires_at', k.expires_at,
    'lifetime_ends_at', v_state->'lifetime_ends_at',
    'pr_merged_at', k.pr_merged_at,
    'refired_after_merge_at', v_state->'refired_after_merge_at',
    'merge_checked', CASE WHEN NOT v_asked_github THEN NULL
                          WHEN v_merged IS NULL THEN 'not_merged_or_unknown'
                          ELSE 'merged' END);
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.fn_claim_reliability_incident(uuid, text, text, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.fn_claim_reliability_incident(uuid, text, text, text, interval) TO service_role;

-- @probe-for: smarter_private.fn_claim_reliability_incident
DO $probe$
DECLARE v_id uuid; v jsonb;
BEGIN
  SELECT id INTO v_id FROM smarter_private.reliability_incidents ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    -- Fixtures are undone with the probe; no claim here names a PR, so the
    -- GitHub read is never reached from the install transaction.
    DELETE FROM smarter_private.reliability_incident_claims WHERE incident_id = v_id;
    v := smarter_private.fn_claim_reliability_incident(v_id, 'probe-lane-a', 'probe/a');
    IF (v->>'claimed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'fresh claim refused: %', v; END IF;
    v := smarter_private.fn_claim_reliability_incident(v_id, 'probe-lane-b');
    IF (v->>'claimed')::boolean OR v->>'owner' <> 'probe-lane-a' THEN RAISE EXCEPTION 'live claim not held: %', v; END IF;
    UPDATE smarter_private.reliability_incident_claims
       SET claimed_at = clock_timestamp() - interval '9 hours', progress_at = clock_timestamp() - interval '9 hours'
     WHERE incident_id = v_id;
    v := smarter_private.fn_claim_reliability_incident(v_id, 'probe-lane-a');
    IF (v->>'claimed')::boolean OR v->>'reason' NOT LIKE 'lifetime_spent%' THEN RAISE EXCEPTION 'spent claim renewed: %', v; END IF;
    v := smarter_private.fn_claim_reliability_incident(v_id, 'probe-lane-b', 'probe/b');
    IF (v->>'claimed')::boolean IS NOT TRUE OR v->>'reason' <> 'superseded_lifetime_spent' THEN RAISE EXCEPTION 'spent claim not superseded: %', v; END IF;
    IF smarter_private.fn_release_reliability_incident_claim(v_id, 'probe-lane-b') IS NOT TRUE THEN RAISE EXCEPTION 'release failed'; END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- ---------------------------------------------------------------------------
-- 5. The handoff line for the claim, in one place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_claim_owner_line(p_incident_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  k smarter_private.reliability_incident_claims;
  v_state jsonb := smarter_private.reliability_incident_claim_state(p_incident_id, now());
  v_who text;
  v_claim text;
BEGIN
  SELECT * INTO k FROM smarter_private.reliability_incident_claims WHERE incident_id = p_incident_id;
  v_claim := 'Claim before working: SELECT smarter_private.fn_claim_reliability_incident('''
             || p_incident_id::text || ''', ''<session>'', ''<branch>'');' || E'\n';
  IF k.incident_id IS NOT NULL THEN
    v_who := smarter_private.reliability_one_line(k.agent_session, 80)
             || coalesce(', branch ' || smarter_private.reliability_one_line(k.branch, 120), '')
             || coalesce(', PR ' || smarter_private.reliability_one_line(k.pull_request, 60), '');
  END IF;
  RETURN CASE v_state->>'state'
    WHEN 'live' THEN
      'Owner: claimed by ' || v_who
      || ', until ' || to_char(k.expires_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago.'
      || ' Coordinate with that owner; do not start a second fix.'
      || ' The claim stops blocking at ' || to_char((k.progress_at + interval '8 hours') AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI')
      || ' America/Chicago unless the owner reports a new branch or PR'
      || CASE WHEN k.pull_request IS NOT NULL
              THEN ', or as soon as that PR has merged and this incident fires again: then claim it, and the claim reads the merge from GitHub.'
              ELSE '.' END
      || E'\n'
    WHEN 'shipped_and_recurred' THEN
      'Owner: unassigned, needs an AI coding agent. The claimed fix shipped and the incident recurred: '
      || v_who || ' merged at '
      || to_char(k.pr_merged_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago and this incident fired again at '
      || to_char((v_state->>'refired_after_merge_at')::timestamptz AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago,'
      || ' so that claim no longer blocks. Check whether that fix is live yet, then fix what remains.' || E'\n'
      || v_claim
    WHEN 'lifetime_spent' THEN
      'Owner: unassigned, needs an AI coding agent. The claim by ' || v_who
      || ' passed its 8-hour lifetime without a new branch or PR, so it no longer blocks. Read that work first.' || E'\n'
      || v_claim
    ELSE
      'Owner: unassigned, needs an AI coding agent' || E'\n' || v_claim
  END;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.reliability_claim_owner_line(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The escalation renders that line (anchored edit of production's own
--    body, which 20261119234324 also edited; the anchor must match once).
-- ---------------------------------------------------------------------------
DO $edit$
DECLARE
  v_def text := pg_get_functiondef('smarter_private.reliability_render_escalation(uuid,text,bigint)'::regprocedure);
  c_old constant text := $old$    || CASE WHEN k.incident_id IS NOT NULL
            THEN 'Owner: claimed by ' || smarter_private.reliability_one_line(k.agent_session, 80)
                 || coalesce(', branch ' || smarter_private.reliability_one_line(k.branch, 120), '')
                 || coalesce(', PR ' || smarter_private.reliability_one_line(k.pull_request, 60), '')
                 || ', until ' || to_char(k.expires_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago.'
                 || ' Coordinate with that owner; do not start a second fix.' || E'\n'
            ELSE 'Owner: unassigned, needs an AI coding agent' || E'\n'
                 || 'Claim before working: SELECT smarter_private.fn_claim_reliability_incident(''' || i.id::text || ''', ''<session>'', ''<branch>'');' || E'\n'
       END
$old$;
  c_new constant text := $new$    || smarter_private.reliability_claim_owner_line(i.id)
$new$;
BEGIN
  IF strpos(v_def, 'reliability_claim_owner_line(i.id)') > 0 THEN
    RAISE NOTICE 'reliability_render_escalation already renders the claim owner line';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'reliability_render_escalation claim anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

-- @probe-for: smarter_private.reliability_render_escalation
DO $probe$
DECLARE v_id uuid; v_text text;
BEGIN
  SELECT id INTO v_id FROM smarter_private.reliability_incidents ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    v_text := smarter_private.reliability_render_escalation(v_id, 'escalation', NULL);
    IF v_text IS NULL OR strpos(v_text, 'Owner: ') = 0 OR strpos(v_text, 'First detected: ') = 0 THEN
      RAISE EXCEPTION 'render lost its Owner or First detected line';
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
