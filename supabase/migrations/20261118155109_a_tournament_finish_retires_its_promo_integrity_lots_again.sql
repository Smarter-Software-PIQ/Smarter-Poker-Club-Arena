-- 20261118155109_a_tournament_finish_retires_its_promo_integrity_lots_again.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A TOURNAMENT FINISH RETIRES ITS PROMO INTEGRITY LOTS AGAIN, AND THE
-- ORPHANED-CHECK WATCH CLOSES WHAT IT OPENED (drift incident 2d8c906b, 2026-11-18)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~15:50 UTC)
--
-- fn_ca_orphaned_checks_watch opened 2d8c906b at 06:18 UTC: three functions
-- named *integrity* that nothing runs. Two are false findings and one is real.
--
-- 1. REAL: fn_ca_promo_integrity_finish_event(uuid) has no caller.
--    20261116161707 (suspect promo chip dumping) injected
--    "PERFORM public.fn_ca_promo_integrity_finish_event(NEW.id);" just before
--    the final RETURN NULL of the tournament terminal trigger function
--    fn_ca_promo_finish_event_principal(). Two and a half hours later
--    20261116190221 (promo winnings retain original source) rewrote that
--    function by CUTTING its body at an anchor that stands before the injected
--    call and appending its own tail, so the call was silently cut away.
--    Production's body (md5 8eddb8e4...) has no such call. A finished
--    tournament no longer retires the promo integrity lots held against it, so
--    their custody would stay held forever. Nothing is held today (0 lots with
--    remaining > 0), so no balance is wrong; the next held lot would be.
-- 2. FALSE: fn_ca_promo_integrity_read(p_club, p_user) and
--    fn_ca_promo_integrity_release(p_case, p_reason) are doors the client
--    calls (src/services/PromoIntegrityService.ts). The watch's "a door is not
--    a check" rule recognises doors only by p_case_id/p_actor-style argument
--    names, which these do not use.
-- 3. The watch only ever RAISES. Its incident has a per-day key and no close
--    path, so it stays open past its deadline even after nothing is orphaned.
-- 4. fn_ca_trial_balance_watch has the same gap. Incident 5a43a8a6 (table_stack,
--    filed 02:20 and 05:20 UTC) was a lag, not a leak: during the Lightning
--    post-commit convoy, balances moved before their ledger rows landed. The
--    hourly table_stack differences read -390.43, -1124.27, -1228.28, +674.90,
--    +230.87, +1852.06, +3.30, then 0.00 from 07:20; over 26 readings they sum
--    to -1.75 (the open hour). The watch's own doctrine says "a real leak does
--    not reverse", but nothing closed the incident once it reversed.
--
-- THE FIX
--
-- 1. fn_ca_promo_finish_event_principal calls fn_ca_promo_integrity_finish_event
--    again, after the profit cleanup and before RETURN NULL (the order
--    20261116161707 installed). Dan's binding ruling of 2026-11-17: promo
--    chips can never cause a tournament payout issue. The integrity step runs
--    in its own subtransaction: a refusal there (custody short) never stops a
--    tournament from finishing; it rolls back only the integrity step, leaves
--    the lots held, and files a critical financial alert naming the event.
-- 2. The two doors are exempt with their reason in ca_check_sweep_exemptions.
-- 3. fn_ca_orphaned_checks_watch closes its own open incidents, verified by
--    re-measuring, when fn_ca_orphaned_checks() returns nothing.
-- 4. fn_ca_trial_balance_watch closes an open incident on an account,
--    verified by re-measuring, when that account's differences summed from 24 h
--    before detection to now are within the threshold AND each of its last
--    three readings is within it. A leak cannot pass that: its sum keeps
--    growing. The close runs in its own subtransaction, so it can never cost
--    the watch its reading.
--
-- No money moves. No lot, custody or ledger row is written by this file.
--
-- @live-proof: position('fn_ca_promo_integrity_finish_event(NEW.id)' in pg_get_functiondef('public.fn_ca_promo_finish_event_principal()'::regprocedure)) > 0 AND position('A WATCH CLOSES WHAT IT OPENED' in pg_get_functiondef('public.fn_ca_orphaned_checks_watch()'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.fn_ca_orphaned_checks()) AND position('A DRIFT THAT REVERSED IS CLOSED BY RE-MEASURING' in pg_get_functiondef('public.fn_ca_trial_balance_watch(timestamp with time zone,numeric)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution (the form 20261118073646 uses). Already the
-- postimage (applied live before merge): a no-op, never a refusal.
CREATE FUNCTION pg_temp.promo_subst(p_sig text, p_before text, p_after text,
                                    p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- 1. The tournament finish retires its promo integrity lots, isolated.
SELECT pg_temp.promo_subst(
  'public.fn_ca_promo_finish_event_principal()',
  '8eddb8e4843357573d11e7729079e8f7', '18beb5801e0b941b73f61985fabfe607',
  ARRAY[
$o1$ PERFORM public.fn_ca_promo_profit_cleanup_settled_event(NEW.id);
 RETURN NULL;
$o1$],
  ARRAY[
$n1$ PERFORM public.fn_ca_promo_profit_cleanup_settled_event(NEW.id);
 -- PROMO INTEGRITY AT THE FINISH (20261118155109): restored after
 -- 20261116190221 cut it away. Isolated: promo chips never stop a tournament
 -- from finishing or paying (Dan, 2026-11-17). A refusal rolls back only this
 -- step, leaves the lots held, and files a critical alert naming the event.
 BEGIN
  PERFORM public.fn_ca_promo_integrity_finish_event(NEW.id);
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.financial_alerts (severity, source, message, context)
  VALUES ('critical', 'PromoIntegrity.finish_event_refused',
   'A finished tournament could not retire its promo integrity lots. The tournament finished and its payouts stand; the lots stay held for review.',
   jsonb_build_object('tournament_id', NEW.id, 'error', left(SQLERRM, 500), 'sqlstate', SQLSTATE,
                      'dedupe_key', NEW.id::text || ':promo_integrity_finish'));
 END;
 RETURN NULL;
$n1$]);

-- 3. The watch closes what it opened, once a re-measurement finds nothing.
SELECT pg_temp.promo_subst(
  'public.fn_ca_orphaned_checks_watch()',
  '57dcbeb8904e9071c134b23760549a64', 'f2b8756683848515b3356de6058832c7',
  ARRAY[
$o2$  RETURN COALESCE(v_n,0);
$o2$],
  ARRAY[
$n2$  -- A WATCH CLOSES WHAT IT OPENED (20261118155109): this watch only raised,
  -- under a per-day key, so its incident outlived the condition it named.
  -- Its own subtransaction: a refused close never costs the watch its answer.
  IF COALESCE(v_n,0) = 0 THEN
    BEGIN
      UPDATE public.ca_drift_incidents
         SET status = 'resolved', closure_basis = 'verified_remeasured', resolved_at = now(),
             root_cause = 'integrity check functions existed that nothing scheduled, swept or called; each has since been scheduled, called by another function, or exempted with its reason',
             correction_ref = 'verified: fn_ca_orphaned_checks() returns no function',
             resolution = 'every integrity check is scheduled, swept, called by another function, or exempt with its reason'
       WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_ca_orphaned_checks_watch could not close its incidents: %', SQLERRM;
    END;
  END IF;
  RETURN COALESCE(v_n,0);
$n2$]);

-- 4. The trial balance watch closes a drift that reversed, by re-measuring.
SELECT pg_temp.promo_subst(
  'public.fn_ca_trial_balance_watch(timestamp with time zone,numeric)',
  '8b7943c6499f505c8d30d7ece01a9ef6', '99e77da7a7f704df514a931a7753b7db',
  ARRAY[
$o3$  v_measured integer := 0;
BEGIN
$o3$,
$o4$  RETURN v_filed;
EXCEPTION WHEN OTHERS THEN
$o4$],
  ARRAY[
$n3$  v_measured integer := 0;
  c        record;
  v_net    numeric;
  v_recent_ok boolean;
BEGIN
$n3$,
$n4$  /* A DRIFT THAT REVERSED IS CLOSED BY RE-MEASURING (20261118155109). The
     doctrine above: a real leak does not reverse. An open incident on an
     account closes, verified_remeasured, when that account's differences
     summed from 24 hours before detection to now are within the threshold AND
     each of its last three readings is within it. A leak cannot pass: its sum
     keeps growing. Before this the watch only raised, so a lag it correctly
     filed (5a43a8a6, the 2026-11-18 post-commit convoy) stayed open forever.
     Its own subtransaction: a failure here never costs the reading above. */
  IF v_measured > 0 THEN
    BEGIN
      FOR c IN
        SELECT i.id, i.detected_at, i.metadata->>'account' AS account
          FROM public.ca_drift_incidents i
         WHERE i.source = 'fn_ca_trial_balance_watch' AND i.resolved_at IS NULL
           AND i.metadata ? 'account'
      LOOP
        SELECT COALESCE(sum((d.detail->'differences'->>c.account)::numeric), 0)
          INTO v_net
          FROM public.ca_detector_runs d
         WHERE d.detector = 'fn_ca_trial_balance_watch'
           AND d.ran_at >= c.detected_at - interval '24 hours';
        SELECT count(*) = 3
               AND bool_and(abs(COALESCE((x.detail->'differences'->>c.account)::numeric, 0)) <= v_thr)
          INTO v_recent_ok
          FROM (SELECT detail FROM public.ca_detector_runs
                 WHERE detector = 'fn_ca_trial_balance_watch'
                 ORDER BY ran_at DESC LIMIT 3) x;
        IF abs(v_net) <= v_thr AND v_recent_ok THEN
          UPDATE public.ca_drift_incidents
             SET status = 'resolved', closure_basis = 'verified_remeasured', resolved_at = now(),
                 root_cause = format('%s drifted between its balance column and the ledger for three windows and then reversed: movements whose ledger leg and balance landed in different windows, not a leak',
                                     c.account),
                 correction_ref = format('verified: %s differences sum to %s from 24 h before detection to now, and its last three readings are within %s',
                                         c.account, v_net, v_thr),
                 resolution = 'the drift reversed: movements whose ledger leg and balance landed in different windows, not a leak; no chips moved'
           WHERE id = c.id AND resolved_at IS NULL;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_ca_trial_balance_watch could not re-measure its open incidents: %', SQLERRM;
    END;
  END IF;

  RETURN v_filed;
EXCEPTION WHEN OTHERS THEN
$n4$]);

-- 2. Two doors the client calls are not checks.
INSERT INTO public.ca_check_sweep_exemptions (proname, reason, added_at)
SELECT x.proname, x.reason, now()
  FROM (VALUES
    ('fn_ca_promo_integrity_read',
     'a door, not a check: the club review screen reads one player''s promo integrity case through it (src/services/PromoIntegrityService.ts); it measures nothing on a schedule'),
    ('fn_ca_promo_integrity_release',
     'a door, not a check: an operator releases a reviewed promo integrity case through it (src/services/PromoIntegrityService.ts); it writes the decision, it does not measure')
  ) x(proname, reason)
 WHERE NOT EXISTS (SELECT 1 FROM public.ca_check_sweep_exemptions e WHERE e.proname = x.proname);

COMMIT;
