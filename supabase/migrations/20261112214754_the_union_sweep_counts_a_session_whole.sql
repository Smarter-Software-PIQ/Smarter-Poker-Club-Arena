-- 20261112214754_the_union_sweep_counts_a_session_whole
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-12 21:47:54 UTC.
--
-- THE UNION SWEEP COUNTS A SESSION WHOLE (2026-11-12)
--
-- Production Alerts fleet, PRIMARY lane, row 377222 (fn_union_integrity_sweep,
-- agent_roster_winning on union fade0000, agent 7e616640).
--
-- WHAT WAS WRONG. The `net` CTE of fn_union_integrity_sweep filtered every
-- wallet_transactions row by its own created_at >= v_from. A cash session or
-- a tournament that began shortly before the 24-hour window therefore brought
-- its cashout or prize into the window without the buy-in that paid for it.
-- Row 377222 reported a net of 183.29 against 12.35 rake: it contained a
-- 136.08 prize from tournament 12ef2263 whose 40.00 buy-in was at
-- 2026-11-11 19:16:24, 17 minutes before the window opened. The defect only
-- inflates a player's net, so the signal can fire on players who did not win
-- what it says. (In 377222 the paired net, 143.29, is still above 10 x rake:
-- an ordinary winning day, no co-seating, no direct transfers, no breach.)
--
-- WHAT THIS CHANGES. One CTE, by pinned-preimage substitution (live md5
-- 2d206e82..., both anchors exactly once, postimage md5 93765162... derived
-- read-only on production with replace()). The sweep reads the roster's
-- scoped wallet rows from v_from - 24 hours (`scoped`), and `net` counts:
--   * every row inside the window, exactly as before; and
--   * a pre-window DEBIT only when the same player has a CREDIT inside the
--     window on the same cash table or the same tournament, and, for cash,
--     only when no cashout at that table came after it and before the window
--     (a finished earlier session at the same table is not pulled in).
-- Pre-window credits are never counted. An open session with no in-window
-- credit gains nothing, so one player's old buy-ins cannot mask another
-- player's winnings under the same agent. Rake, transfers and co-seating
-- are untouched.
--
-- MEASURED (read-only SELECT on production, 2026-11-12 ~21:55 UTC, the window
-- of 377222, v_from 2026-11-11 19:33): of seven agents with movement, exactly
-- one net changed: 7e616640 from 155.38 to 115.38, the 40.00 buy-in of
-- 12ef2263. Every other agent's net is identical, including the owner-agent
-- roster whose open 8aea2cc5 session has pre-window debits and no in-window
-- cashout (not pulled in, as designed).
--
-- GUARDS: refuses in the break window; refuses an unknown preimage; exact
-- readback; owner, SECURITY DEFINER, configuration and ACL proven unchanged.
-- No money, seat, ledger or alert row is written.
-- @live-proof: md5(pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'::regprocedure)) = '93765162c4d5e216947137b27862446f'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_reason text;
BEGIN
  v_reason := public.fn_ca_break_window_refuses_migrations(now());
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'UNION_SWEEP_SESSION_WHOLE_REFUSED: %', v_reason USING ERRCODE = '55000';
  END IF;
END
$pre$;

DO $install$
DECLARE
  c_sig constant text := 'public.fn_union_integrity_sweep(uuid,integer)';
  c_old_a constant text := $olda$  net AS (
    SELECT r.agent_id,
           SUM(CASE WHEN wt.type='credit' AND wt.category IN ('cashout','prize','bounty') THEN wt.amount ELSE 0 END)
         - SUM(CASE WHEN wt.type='debit'  AND wt.category IN ('buyin','rebuy','addon','tournament_buyin') THEN wt.amount ELSE 0 END) AS player_net,
           COUNT(DISTINCT r.player_id) AS players
      FROM roster r
      JOIN wallet_transactions wt ON wt.user_id = r.player_id AND wt.created_at >= v_from
$olda$;
  c_new_a constant text := $newa$  /* A SESSION IS COUNTED WHOLE (2026-11-12). The net used to read each
     wallet row by its own created_at, so a cash session or tournament that
     began just before the window brought its cashout or prize in without the
     buy-in that paid for it (row 377222: a 136.08 prize counted against no
     40.00 buy-in, 17 minutes outside the window). Rows of the previous 24
     hours are read as well, and a pre-window DEBIT counts only when the same
     player has a CREDIT in the window on the same table (cash) or tournament,
     and for cash only when no cashout at that table closed it before the
     window. Nothing else from before the window is counted. */
  scoped AS MATERIALIZED (
    SELECT r.agent_id, r.player_id, wt.type, wt.category, wt.amount, wt.created_at,
           wt.table_id, wt.related_entity_id
      FROM roster r
      JOIN wallet_transactions wt ON wt.user_id = r.player_id
                                 AND wt.created_at >= v_from - interval '24 hours'
$newa$;
  c_old_b constant text := $oldb$     GROUP BY r.agent_id
  ),
  rake AS (
$oldb$;
  c_new_b constant text := $newb$  ),
  net AS (
    SELECT s.agent_id,
           SUM(CASE WHEN s.type='credit' AND s.category IN ('cashout','prize','bounty') THEN s.amount ELSE 0 END)
         - SUM(CASE WHEN s.type='debit'  AND s.category IN ('buyin','rebuy','addon','tournament_buyin') THEN s.amount ELSE 0 END) AS player_net,
           COUNT(DISTINCT s.player_id) AS players
      FROM scoped s
     WHERE s.created_at >= v_from
        OR (s.type = 'debit'
            AND EXISTS (SELECT 1 FROM scoped w
                         WHERE w.player_id = s.player_id AND w.type = 'credit'
                           AND w.created_at >= v_from
                           AND w.table_id IS NOT DISTINCT FROM s.table_id
                           AND (s.table_id IS NOT NULL OR w.related_entity_id = s.related_entity_id))
            AND (s.table_id IS NULL OR NOT EXISTS (
                  SELECT 1 FROM scoped c
                   WHERE c.player_id = s.player_id AND c.table_id = s.table_id
                     AND c.type = 'credit' AND c.category = 'cashout'
                     AND c.created_at > s.created_at AND c.created_at < v_from)))
     GROUP BY s.agent_id
  ),
  rake AS (
$newb$;
  v_oid oid := to_regprocedure(c_sig);
  v_def text;
  v_new text;
  v_owner oid; v_secdef boolean; v_config text[]; v_acl text;
BEGIN
  IF current_user <> 'postgres' OR v_oid IS NULL THEN
    RAISE EXCEPTION 'union sweep session: owner/target mismatch';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) = '93765162c4d5e216947137b27862446f' THEN
    RETURN;
  END IF;
  IF md5(v_def) <> '2d206e82cdc6c2459621ace94808eae6' THEN
    RAISE EXCEPTION 'union sweep session: unexpected live body %', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old_a, ''))) / length(c_old_a) <> 1 THEN
    RAISE EXCEPTION 'union sweep session: the net head is not exactly once';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old_b, ''))) / length(c_old_b) <> 1 THEN
    RAISE EXCEPTION 'union sweep session: the net tail is not exactly once';
  END IF;
  v_new := replace(replace(v_def, c_old_a, c_new_a), c_old_b, c_new_b);
  IF md5(v_new) <> '93765162c4d5e216947137b27862446f' THEN
    RAISE EXCEPTION 'union sweep session: computed postimage is %', md5(v_new);
  END IF;
  SELECT p.proowner, p.prosecdef, p.proconfig, p.proacl::text
    INTO v_owner, v_secdef, v_config, v_acl FROM pg_proc p WHERE p.oid = v_oid;
  EXECUTE v_new;
  IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'union sweep session: exact readback failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND p.proowner = v_owner AND p.prosecdef = v_secdef
                   AND p.proconfig IS NOT DISTINCT FROM v_config
                   AND p.proacl::text IS NOT DISTINCT FROM v_acl
                   AND v_acl = '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') THEN
    RAISE EXCEPTION 'union sweep session: authority drift';
  END IF;
END
$install$;

COMMIT;
