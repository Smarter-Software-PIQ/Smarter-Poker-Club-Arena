-- Expected figures are written out by hand from pre.sql and post.sql, not
-- read back from the projection.
DO $check$
DECLARE
  K uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'; F uuid := 'a0000000-0000-0000-0000-000000000001';
  D uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
  r record; bad text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (K, date '2026-11-01', 1.00, 30.00), (K, date '2026-11-02', 7.50, -6.40), (F, date '2026-11-02', 0.00, -0.50),
      (D, date '2026-11-02', 3.25, -4.00), (K, date '2026-11-03', 6.00, 1.00), (F, date '2026-11-03', 4.00, 2.00),
      (D, date '2026-11-03', 2.00, -1.20), (F, date '2026-11-08', 0.00, 15.00), (F, date '2026-11-09', 0.00, -15.00)
    ) e(club, day, fee, result)
  LOOP
    IF (SELECT COALESCE(sum(x.fee), 0) FROM ca_club_acct_fact x WHERE x.club_id = r.club AND x.acct_day = r.day) <> r.fee
       OR (SELECT COALESCE(sum(x.result), 0) FROM ca_club_acct_fact x WHERE x.club_id = r.club AND x.acct_day = r.day) <> r.result THEN
      bad := bad || format(' %s/%s fee %s result %s;', r.club, r.day,
        (SELECT sum(x.fee) FROM ca_club_acct_fact x WHERE x.club_id = r.club AND x.acct_day = r.day),
        (SELECT sum(x.result) FROM ca_club_acct_fact x WHERE x.club_id = r.club AND x.acct_day = r.day));
    END IF;
  END LOOP;
  IF bad <> '' THEN RAISE EXCEPTION 'club/day totals differ:%', bad; END IF;

  -- Nothing outside the expected club-days.
  IF EXISTS (SELECT 1 FROM ca_club_acct_fact x WHERE (x.club_id, x.acct_day) NOT IN (
      (K, '2026-11-01'), (K, '2026-11-02'), (F, '2026-11-02'), (D, '2026-11-02'), (K, '2026-11-03'),
      (F, '2026-11-03'), (D, '2026-11-03'), (F, '2026-11-08'), (F, '2026-11-09'))) THEN
    RAISE EXCEPTION 'unexpected club/day rows: %', (SELECT string_agg(x.club_id || '/' || x.acct_day, ',') FROM ca_club_acct_fact f);
  END IF;

  -- Each writer owns its rows: the seed (1), the live projection (0), the certificate (2).
  IF (SELECT sum(result) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-02' AND src = 1) <> 24.60
     OR (SELECT sum(result) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-02' AND src = 0) <> -1.00
     OR (SELECT sum(result) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-02' AND src = 2) <> -30.00
     OR (SELECT sum(fee) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-03' AND src = 1) <> 4.00
     OR (SELECT sum(fee) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-03' AND src = 0) <> 2.00 THEN
    RAISE EXCEPTION 'a row is owned by the wrong writer';
  END IF;

  -- Buy-ins and cash-outs are reported; the cash result is the hands.
  IF (SELECT sum(buyins) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-02') <> 110
     OR (SELECT sum(cashouts) FROM ca_club_acct_fact WHERE club_id = K AND acct_day = '2026-11-02') <> 135 THEN
    RAISE EXCEPTION 'buy-ins/cash-outs differ';
  END IF;

  -- Hands each club took part in, per table.
  IF (SELECT string_agg(club_id || ':' || acct_day || ':' || table_id || '=' || h, ',' ORDER BY club_id, acct_day, table_id)
        FROM (SELECT club_id, acct_day, table_id, sum(hands) h FROM ca_club_acct_hands GROUP BY 1, 2, 3) x)
     IS DISTINCT FROM
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02:c0000000-0000-0000-0000-000000000001=1,'
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02:c0000000-0000-0000-0000-000000000002=1,'
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-03:c0000000-0000-0000-0000-000000000001=1,'
     'a0000000-0000-0000-0000-000000000001:2026-11-02:c0000000-0000-0000-0000-000000000001=3,'
     'a0000000-0000-0000-0000-000000000001:2026-11-03:c0000000-0000-0000-0000-000000000002=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02:c0000000-0000-0000-0000-000000000001=2,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02:c0000000-0000-0000-0000-000000000002=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03:c0000000-0000-0000-0000-000000000001=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03:c0000000-0000-0000-0000-000000000002=1' THEN
    RAISE EXCEPTION 'hand counts differ: %', (SELECT string_agg(club_id || ':' || acct_day || ':' || table_id || '=' || hands, ',') FROM ca_club_acct_hands);
  END IF;

  -- The failed projection is recorded, and the share it followed committed.
  IF (SELECT count(*) FROM ca_club_acct_projection_failures WHERE source = 'bbj_award' AND acct_day = '2026-11-03') <> 1
     OR (SELECT count(*) FROM ca_club_acct_projection_failures) <> 1
     OR NOT EXISTS (SELECT 1 FROM bbj_payout_recipients WHERE user_id = 'bbb00000-0000-0000-0000-0000000000ff') THEN
    RAISE EXCEPTION 'failure record: %', (SELECT string_agg(source || ' ' || detail, ' | ') FROM ca_club_acct_projection_failures);
  END IF;

  -- The tournament game of a carried entry is its tournament.
  IF NOT EXISTS (SELECT 1 FROM ca_club_acct_fact WHERE src = 2 AND game_id = 'd0000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION 'carried entry lost its tournament';
  END IF;
  RAISE NOTICE 'CLUB DATA ACCOUNTING READ MODEL SCENARIO PASSED';
END $check$;
