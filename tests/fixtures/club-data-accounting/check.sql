-- Expected figures are written out by hand from pre.sql and post.sql, not
-- read back from the projection. Readers sum the aggregate rows and the
-- journal once each, so every figure here does too.
CREATE OR REPLACE TEMP VIEW all_facts AS
  SELECT club_id, acct_day, kind, game_id, user_id, fee, result, buyins, cashouts, hands, src FROM ca_club_acct_fact
  UNION ALL
  SELECT club_id, acct_day, kind, game_id, user_id, fee, result, buyins, cashouts, hands, 0::smallint FROM ca_club_acct_fact_journal;
CREATE OR REPLACE TEMP VIEW all_hands AS
  SELECT club_id, acct_day, table_id, hands, src FROM ca_club_acct_hands
  UNION ALL
  SELECT club_id, acct_day, table_id, hands, 0::smallint FROM ca_club_acct_hands_journal;
DO $check$
DECLARE
  K uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'; F uuid := 'a0000000-0000-0000-0000-000000000001';
  D uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
  r record; bad text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (K, date '2026-11-01', 1.00, 0.00), (K, date '2026-11-02', 7.50, -6.40), (F, date '2026-11-02', 0.00, 3.50),
      (D, date '2026-11-02', 3.25, 2.00), (K, date '2026-11-03', 6.00, 1.00), (F, date '2026-11-03', 4.00, 2.00),
      (D, date '2026-11-03', 2.00, -1.20), (F, date '2026-11-08', 0.00, 12.00), (F, date '2026-11-09', 0.00, -15.00)
    ) e(club, day, fee, result)
  LOOP
    IF (SELECT COALESCE(sum(x.fee), 0) FROM all_facts x WHERE x.club_id = r.club AND x.acct_day = r.day) <> r.fee
       OR (SELECT COALESCE(sum(x.result), 0) FROM all_facts x WHERE x.club_id = r.club AND x.acct_day = r.day) <> r.result THEN
      bad := bad || format(' %s/%s fee %s result %s;', r.club, r.day,
        (SELECT sum(x.fee) FROM all_facts x WHERE x.club_id = r.club AND x.acct_day = r.day),
        (SELECT sum(x.result) FROM all_facts x WHERE x.club_id = r.club AND x.acct_day = r.day));
    END IF;
  END LOOP;
  IF bad <> '' THEN RAISE EXCEPTION 'club/day totals differ:%', bad; END IF;

  -- Nothing outside the expected club-days.
  IF EXISTS (SELECT 1 FROM all_facts x WHERE (x.club_id, x.acct_day) NOT IN (
      (K, '2026-11-01'), (K, '2026-11-02'), (F, '2026-11-02'), (D, '2026-11-02'), (K, '2026-11-03'),
      (F, '2026-11-03'), (D, '2026-11-03'), (F, '2026-11-08'), (F, '2026-11-09'))) THEN
    RAISE EXCEPTION 'unexpected club/day rows: %', (SELECT string_agg(x.club_id || '/' || x.acct_day, ',') FROM all_facts x);
  END IF;

  -- Each writer owns its rows: the seed (1), the live projection (0), the certificate (2).
  IF (SELECT sum(result) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-02' AND src = 1) <> 24.60
     OR (SELECT sum(result) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-02' AND src = 0) <> -1.00
     OR (SELECT sum(result) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-02' AND src = 2) <> -30.00
     OR (SELECT sum(fee) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-03' AND src = 1) <> 4.00
     OR (SELECT sum(fee) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-03' AND src = 0) <> 2.00 THEN
    RAISE EXCEPTION 'a row is owned by the wrong writer';
  END IF;

  -- Tournament buy-ins and cash-outs are the receipt-owned flows; cash flows
  -- are not projected (the cash result is the hands).
  IF (SELECT sum(buyins) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-02') <> 10
     OR (SELECT sum(cashouts) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-02') <> 25
     OR (SELECT sum(cashouts) FROM all_facts WHERE club_id = F AND acct_day = '2026-11-02') <> 4
     OR (SELECT sum(cashouts) FROM all_facts WHERE club_id = D AND acct_day = '2026-11-02') <> 6
     OR (SELECT sum(cashouts) FROM all_facts WHERE club_id = K AND acct_day = '2026-11-03') <> 2 THEN
    RAISE EXCEPTION 'buy-ins/cash-outs differ';
  END IF;

  -- Each side of a boundary is the version its week's invoice used, or
  -- nothing (not invoice-exact) when no kept version qualifies.
  IF (SELECT string_agg(boundary || ':' || opening_exact || ':' || closing_exact, ',' ORDER BY boundary)
        FROM ca_club_acct_boundary_log) IS DISTINCT FROM
     '2026-11-02 08:00:00+00:true:false,2026-11-09 08:00:00+00:true:true'
     OR (SELECT closing_md5 FROM ca_club_acct_boundary_log WHERE boundary = '2026-11-09 08:00+00')
        IS DISTINCT FROM (SELECT value_md5 FROM ca_union_pnl_boundary_capture
                           WHERE boundary = '2026-11-09 08:00+00' AND certified_at = '2026-11-11 03:43:14+00')
     OR (SELECT opening_md5 FROM ca_club_acct_boundary_log WHERE boundary = '2026-11-09 08:00+00')
        IS DISTINCT FROM (SELECT value_md5 FROM ca_union_pnl_boundary_capture
                           WHERE boundary = '2026-11-09 08:00+00' AND certified_at = '2026-11-12 00:00+00') THEN
    RAISE EXCEPTION 'boundary versions: %', (SELECT string_agg(g::text, ' | ') FROM ca_club_acct_boundary_log g);
  END IF;

  -- The club hand count per table: raked hands in which a player of the
  -- club changed stack (T1#3 and T2#2 are unraked; The Felt Society's
  -- zero-delta seat in T1#5 does not count it; T1#6 names no earning club
  -- with a stack change, so it is the table club's).
  IF (SELECT string_agg(club_id || ':' || acct_day || ':' || table_id || '=' || h, ',' ORDER BY club_id, acct_day, table_id)
        FROM (SELECT club_id, acct_day, table_id, sum(hands) h FROM all_hands GROUP BY 1, 2, 3) x)
     IS DISTINCT FROM
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02:c0000000-0000-0000-0000-000000000002=1,'
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-03:c0000000-0000-0000-0000-000000000001=1,'
     'a0000000-0000-0000-0000-000000000001:2026-11-02:c0000000-0000-0000-0000-000000000001=2,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02:c0000000-0000-0000-0000-000000000001=2,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02:c0000000-0000-0000-0000-000000000002=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03:c0000000-0000-0000-0000-000000000001=1,'
     'fade0000-0000-0000-0000-000000000001:2026-11-03:c0000000-0000-0000-0000-000000000001=1' THEN
    RAISE EXCEPTION 'hand counts differ: %', (SELECT string_agg(club_id || ':' || acct_day || ':' || table_id || '=' || hands, ',') FROM ca_club_acct_hands);
  END IF;

  -- Cash hands each player took part in, per club, table and day (escrow
  -- reshaping and loads net to one per hand).
  IF (SELECT string_agg(club_id || ':' || acct_day || ':' || game_id || ':' || user_id || '=' || h, ',' ORDER BY club_id, acct_day, game_id, user_id)
        FROM (SELECT club_id, acct_day, game_id, user_id, sum(hands) h FROM all_facts GROUP BY 1, 2, 3, 4 HAVING sum(hands) <> 0) x)
     IS DISTINCT FROM
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02:c0000000-0000-0000-0000-000000000001:11111111-0000-0000-0000-000000000003=1,'
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02:c0000000-0000-0000-0000-000000000002:11111111-0000-0000-0000-000000000003=1,'
     '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-03:c0000000-0000-0000-0000-000000000001:11111111-0000-0000-0000-000000000003=1,'
     'a0000000-0000-0000-0000-000000000001:2026-11-02:c0000000-0000-0000-0000-000000000001:11111111-0000-0000-0000-000000000002=3,'
     'a0000000-0000-0000-0000-000000000001:2026-11-03:c0000000-0000-0000-0000-000000000001:11111111-0000-0000-0000-000000000002=1,'
     'a0000000-0000-0000-0000-000000000001:2026-11-03:c0000000-0000-0000-0000-000000000002:11111111-0000-0000-0000-000000000003=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02:c0000000-0000-0000-0000-000000000001:11111111-0000-0000-0000-000000000001=2,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02:c0000000-0000-0000-0000-000000000002:11111111-0000-0000-0000-000000000001=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03:c0000000-0000-0000-0000-000000000001:11111111-0000-0000-0000-000000000001=1,'
     'a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03:c0000000-0000-0000-0000-000000000002:11111111-0000-0000-0000-000000000001=1' THEN
    RAISE EXCEPTION 'player hand counts differ: %', (SELECT string_agg(club_id || ':' || acct_day || ':' || game_id || ':' || user_id || '=' || h, ',' ORDER BY club_id, acct_day, game_id, user_id)
        FROM (SELECT club_id, acct_day, game_id, user_id, sum(hands) h FROM all_facts GROUP BY 1, 2, 3, 4 HAVING sum(hands) <> 0) x);
  END IF;

  -- The failed projection is recorded, and the share it followed committed;
  -- the posted prize no receipt owns (pre.sql) is a failure of its day,
  -- never a silent drop, and a day load does not resolve it.
  IF (SELECT count(*) FROM ca_club_acct_projection_failures WHERE source = 'bbj_award' AND acct_day = '2026-11-03') <> 1
     OR NOT EXISTS (SELECT 1 FROM bbj_payout_recipients WHERE user_id = 'bbb00000-0000-0000-0000-0000000000ff')
     OR NOT EXISTS (SELECT 1 FROM ca_club_acct_projection_failures WHERE source = 'tournament_flow_unclassified'
                     AND source_key = 'f1000000-0000-0000-0000-00000000000b' AND acct_day = '2026-11-03')
     OR (SELECT string_agg(source || ':' || acct_day, ',' ORDER BY acct_day) FROM ca_club_acct_projection_failures WHERE resolved_at IS NULL)
        IS DISTINCT FROM 'tournament_flow_unclassified:2026-11-02,tournament_flow_unclassified:2026-11-03' THEN
    RAISE EXCEPTION 'failure record: %', (SELECT string_agg(source || ' ' || acct_day || ' ' || detail || ' ' || (resolved_at IS NULL), ' | ')
                                            FROM ca_club_acct_projection_failures);
  END IF;

  -- The tournament game of a carried entry is its tournament.
  IF NOT EXISTS (SELECT 1 FROM all_facts WHERE src = 2 AND game_id = 'd0000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION 'carried entry lost its tournament';
  END IF;
  RAISE NOTICE 'CLUB DATA ACCOUNTING READ MODEL SCENARIO PASSED';
END $check$;
