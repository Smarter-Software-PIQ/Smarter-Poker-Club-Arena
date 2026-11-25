CREATE OR REPLACE FUNCTION public.fn_ca_ledger_audit_checkpoint_advance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_horizon timestamptz; v_from timestamptz; v_through timestamptz;
  v_n bigint; v_to numeric; v_out numeric;
  v_report jsonb := '{}'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca_ledger_audit_checkpoint_advance', 0)) THEN
    RETURN jsonb_build_object('skipped', 'another advance holds the lock');
  END IF;

  -- THE HORIZON. A leg is written with created_at = its transaction's start
  -- and the journal is append-only, so once every transaction that began
  -- before an instant has ended, no leg older than it can still appear. Six
  -- hours back, and a minute before the oldest transaction still open.
  SELECT LEAST(now() - interval '6 hours', COALESCE(min(a.xact_start), now()) - interval '1 minute')
    INTO v_horizon
    FROM pg_stat_activity a WHERE a.xact_start IS NOT NULL;

  -- 1. Member nets since the chip baseline (fn_chip_drift_since_baseline).
  SELECT min(b.taken_at) INTO v_from FROM public.ca_chip_baseline b;
  IF v_from IS NOT NULL THEN
    SELECT m.through_at INTO v_through FROM public.ca_ledger_audit_marks m
     WHERE m.metric = 'chip_drift' AND m.from_at = v_from FOR UPDATE;
    IF NOT FOUND THEN
      DELETE FROM public.ca_ledger_audit_member_net WHERE true;  -- a reset: the baseline moved, every remembered net is void
      INSERT INTO public.ca_ledger_audit_marks AS m (metric, from_at, through_at, legs, advanced_at)
      VALUES ('chip_drift', v_from, v_from, 0, now())
      ON CONFLICT (metric) DO UPDATE
        SET from_at = EXCLUDED.from_at, through_at = EXCLUDED.through_at,
            to_total = 0, from_total = 0, legs = 0, advanced_at = now();
      v_through := v_from;
    END IF;
    IF v_horizon > v_through THEN
      WITH sides AS (
        SELECT cl.club_id AS c_id, cl.to_entity_id AS u_id, cl.amount AS amt
          FROM public.chip_ledger cl
         WHERE cl.club_id IS NOT NULL AND cl.to_type = 'player_wallet'
           AND cl.created_at >= v_through AND cl.created_at < v_horizon
        UNION ALL
        SELECT cl.club_id, cl.from_entity_id, -cl.amount
          FROM public.chip_ledger cl
         WHERE cl.club_id IS NOT NULL AND cl.from_type = 'player_wallet'
           AND cl.created_at >= v_through AND cl.created_at < v_horizon
      ), d AS (
        SELECT s.c_id, s.u_id, sum(s.amt) AS net, count(*) AS n
          FROM sides s WHERE s.u_id IS NOT NULL GROUP BY 1, 2
      ), up AS (
        INSERT INTO public.ca_ledger_audit_member_net AS t (club_id, user_id, net)
        SELECT d.c_id, d.u_id, d.net FROM d
        ON CONFLICT (club_id, user_id) DO UPDATE SET net = t.net + EXCLUDED.net
        RETURNING 1
      )
      SELECT COALESCE((SELECT sum(d.n) FROM d), 0) INTO v_n;
      UPDATE public.ca_ledger_audit_marks
         SET through_at = v_horizon, legs = legs + v_n, advanced_at = now()
       WHERE metric = 'chip_drift';
      v_report := v_report || jsonb_build_object('chip_drift', jsonb_build_object('through', v_horizon, 'legs', v_n));
    END IF;
  END IF;

  -- 2. BBJ legs since the epoch (fn_bbj_conservation_check).
  SELECT min(s.taken_at) INTO v_from FROM public.ca_bbj_pool_snapshots s WHERE s.is_baseline;
  IF v_from IS NOT NULL THEN
    SELECT m.through_at INTO v_through FROM public.ca_ledger_audit_marks m
     WHERE m.metric = 'bbj_epoch' AND m.from_at = v_from FOR UPDATE;
    IF NOT FOUND THEN
      DELETE FROM public.ca_ledger_audit_bbj_pool WHERE true;  -- a reset: the epoch moved, every remembered pool total is void
      INSERT INTO public.ca_ledger_audit_marks AS m (metric, from_at, through_at, legs, advanced_at)
      VALUES ('bbj_epoch', v_from, v_from, 0, now())
      ON CONFLICT (metric) DO UPDATE
        SET from_at = EXCLUDED.from_at, through_at = EXCLUDED.through_at,
            to_total = 0, from_total = 0, legs = 0, advanced_at = now();
      v_through := v_from;
    END IF;
    IF v_horizon > v_through THEN
      -- Every pool, both directions (the epoch identity).
      SELECT COALESCE(sum(CASE WHEN l.to_type = 'bbj_pool' THEN l.amount ELSE 0 END), 0),
             COALESCE(sum(CASE WHEN l.from_type = 'bbj_pool' THEN l.amount ELSE 0 END), 0),
             count(*)
        INTO v_to, v_out, v_n
        FROM public.chip_ledger l
       WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
         AND l.created_at > v_from AND l.created_at >= v_through AND l.created_at < v_horizon;

      -- The pools opened after the epoch, which is the set the check reads
      -- seeds and burns for, and every pool already kept (so a kept row is
      -- never left behind its mark). A pool that joins the set later has no
      -- row and is read whole by the check until the next advance gives it one.
      WITH late AS (
        SELECT p.id AS pool_id, (x.pool_id IS NOT NULL) AS kept, b.opened_at,
               x.absorbed AS kept_absorbed, x.absorbed_to AS kept_absorbed_to
          FROM public.bbj_pools p
          LEFT JOIN (SELECT s.pool_id, min(s.taken_at) AS opened_at
                       FROM public.ca_bbj_pool_snapshots s
                      WHERE s.is_baseline
                      GROUP BY s.pool_id) b ON b.pool_id = p.id
          LEFT JOIN public.ca_ledger_audit_bbj_pool x ON x.pool_id = p.id
         WHERE COALESCE(b.opened_at, p.created_at) > v_from OR x.pool_id IS NOT NULL
      ), sums AS (
        SELECT o.pool_id,
               COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                          WHERE l.to_entity_id = o.pool_id AND l.to_type = 'bbj_pool'
                            AND l.category <> 'bbj_contribution'
                            AND l.created_at > v_from
                            AND l.created_at >= CASE WHEN o.kept THEN v_through ELSE '-infinity'::timestamptz END
                            AND l.created_at < v_horizon), 0) AS seeded,
               COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                          WHERE l.from_entity_id = o.pool_id AND l.from_type = 'bbj_pool'
                            AND l.category NOT IN ('bbj_payout', 'promo')
                            AND l.created_at > v_from
                            AND l.created_at >= CASE WHEN o.kept THEN v_through ELSE '-infinity'::timestamptz END
                            AND l.created_at < v_horizon), 0) AS burned,
               -- The legs an opening absorbed, (epoch, opening], kept once
               -- the opening is older than the horizon; read again only if
               -- the opening moves.
               CASE WHEN o.opened_at IS NULL OR o.opened_at >= v_horizon THEN NULL
                    WHEN o.kept_absorbed_to IS NOT DISTINCT FROM o.opened_at THEN o.kept_absorbed
                    ELSE COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                                    WHERE l.to_entity_id = o.pool_id AND l.to_type = 'bbj_pool'
                                      AND l.created_at > v_from AND l.created_at <= o.opened_at), 0)
                       - COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                                    WHERE l.from_entity_id = o.pool_id AND l.from_type = 'bbj_pool'
                                      AND l.created_at > v_from AND l.created_at <= o.opened_at), 0) END AS absorbed,
               CASE WHEN o.opened_at IS NULL OR o.opened_at >= v_horizon THEN NULL ELSE o.opened_at END AS absorbed_to
          FROM late o
      )
      INSERT INTO public.ca_ledger_audit_bbj_pool AS t (pool_id, seeded, burned, absorbed, absorbed_to)
      SELECT s.pool_id, s.seeded, s.burned, s.absorbed, s.absorbed_to FROM sums s
      ON CONFLICT (pool_id) DO UPDATE
        SET seeded = t.seeded + EXCLUDED.seeded, burned = t.burned + EXCLUDED.burned,
            absorbed = EXCLUDED.absorbed, absorbed_to = EXCLUDED.absorbed_to;

      UPDATE public.ca_ledger_audit_marks
         SET through_at = v_horizon, to_total = to_total + v_to, from_total = from_total + v_out,
             legs = legs + v_n, advanced_at = now()
       WHERE metric = 'bbj_epoch';
      v_report := v_report || jsonb_build_object('bbj_epoch', jsonb_build_object('through', v_horizon, 'legs', v_n));
    END IF;
  END IF;

  RETURN v_report;
END;
$function$

