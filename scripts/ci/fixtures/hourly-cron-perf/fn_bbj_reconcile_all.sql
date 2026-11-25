CREATE OR REPLACE FUNCTION public.fn_bbj_reconcile_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record; s public.ca_bbj_pool_snapshots%ROWTYPE; prev public.ca_bbj_pool_snapshots%ROWTYPE;
  v_out jsonb := '[]'::jsonb; v_two numeric; v_prev_cum numeric := 0; v_comparable boolean := false;
  v_alerts int := 0; v_opened int := 0;
BEGIN
  IF NOT (current_user IN ('postgres', 'supabase_admin') OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'fn_bbj_reconcile_all is service only' USING ERRCODE = '42501';
  END IF;
  FOR p IN SELECT b.id, b.union_id, b.club_id FROM public.bbj_pools b WHERE b.status = 'active' ORDER BY b.created_at LOOP
    -- A pool the meter has never seen opens its own balance (second cut).
    IF NOT EXISTS (SELECT 1 FROM public.ca_bbj_pool_snapshots x WHERE x.pool_id = p.id) THEN
      PERFORM public.fn_bbj_open_pool_baseline(p.id);
      v_opened := v_opened + 1;
    END IF;
    s := public.fn_bbj_reconcile(p.id);
    SELECT * INTO prev FROM public.ca_bbj_pool_snapshots WHERE id = s.prev_id;
    -- Two consecutive snapshots: a leg that commits after a read straddles one
    -- boundary and reverses at the next, so a single-interval swing is noise
    -- and a two-interval sum is a finding.
    /* The residue is now cumulative since the pool's opening balance, so a
       drop that straddled a reading is inside the next one and the number
       comes back on its own. What cannot come back on its own is a leak, and
       a leak grows: the finding is a non-zero residue that moved FURTHER in
       the same direction than the reading before it. */
    v_two := s.unexplained_main + s.unexplained_backup + s.unexplained_promo;
    /* NOT COMPARABLE IS NOT GROWTH (2026-09-09). prev may have been taken
       before this meter changed what it measures. Two numbers from two
       different bases say nothing about each other, and calling the
       difference growth is how the basis change of 10:21 today raised two
       incidents against pools that had not moved. When the bases differ the
       reading is recorded and the growth test is skipped for that one run;
       the next run has a comparable predecessor and the test resumes. A
       write failure is a fact rather than a comparison, so it still raises
       on its own below. */
    v_comparable := (prev.id IS NOT NULL AND NOT prev.is_baseline
                     AND prev.basis_version IS NOT DISTINCT FROM s.basis_version);
    v_prev_cum := COALESCE(CASE WHEN prev.is_baseline THEN 0
                                ELSE prev.unexplained_main + prev.unexplained_backup + prev.unexplained_promo END, 0);
    IF (v_comparable AND abs(v_two) > 0.01 AND abs(v_two) > abs(v_prev_cum)
        AND sign(v_two) = COALESCE(NULLIF(sign(v_prev_cum), 0), sign(v_two)))
       OR s.write_failures > 0 THEN
      v_alerts := v_alerts + 1;
      -- PHASE 6.2 (2026-09-05): the kill switch reads every pool's two-snapshot figure.
      PERFORM public.fn_ca_kill_switch_trip('fn_bbj_reconcile', v_two,
        format('BBJ pool %s moved %s beyond the journal over two snapshots', p.id, round(v_two, 2)));
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_bbj_reconcile', 'bbj_error', CASE WHEN abs(v_two) >= 100 OR s.write_failures > 0 THEN 'critical' ELSE 'warning' END,
        'bbj-meter:' || p.id::text || ':' || to_char(s.taken_at, 'YYYY-MM-DD-HH24'),
        round(v_two, 2), 0, round(v_two, 2), 'ledger', 'bbj_pools', p.id, p.club_id, p.union_id,
        NULL, NULL, NULL, NULL, NULL, NULL,
        format('BBJ pool banks are %s beyond the journal since this pool opened, up from %s at the previous reading (main %s, backup %s, promo %s; %s ledger write failure(s)): a bbj_pools write without a leg, or a leg without a write. A residue that grows in the same direction twice is not a reading boundary.',
               round(v_two, 2), round(v_prev_cum, 2), s.unexplained_main, s.unexplained_backup, s.unexplained_promo, s.write_failures),
        false,
        jsonb_build_object('snapshot_id', s.id, 'pool_id', p.id, 'unexplained_main', s.unexplained_main,
                           'unexplained_backup', s.unexplained_backup, 'unexplained_promo', s.unexplained_promo,
                           'write_failures', s.write_failures));
    END IF;
    v_out := v_out || jsonb_build_object('pool_id', p.id, 'snapshot_id', s.id,
                'main', s.main, 'backup', s.backup, 'promo', s.promo,
                'unexplained', round(s.unexplained_main + s.unexplained_backup + s.unexplained_promo, 2),
                'drops', s.drops_since, 'payouts', s.payouts_since, 'sweeps', s.sweeps_since);
  END LOOP;
  /* THIS METER RAISES UNDER A FRESH KEY EVERY HOUR, so an incident it has
     stopped reporting can never fold into a later one and can never close on
     its own: left alone it accumulates one open row per pool per hour
     forever. Recording the run lets fn_ca_resolve_cleared_incidents close
     what two consecutive readings have declined to raise. */
  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_bbj_reconcile', jsonb_build_object('alerts', v_alerts, 'opened', v_opened));

  RETURN jsonb_build_object('pools', v_out, 'alerts', v_alerts, 'opened', v_opened);
END;
$function$

