-- 20261115151824_union_statements_credit_the_misplaced_jackpot_shares.sql
--
-- Version reserved by scripts/reserve-migration-version.sh.
--
-- SETTLEMENT (CLAUDE.md 10.9) for audit finding D1, after its root fix
-- 20261115150131_a_jackpot_share_follows_the_hand_club.
--
-- OWNER RULE (2026-11-15): each club's numbers reflect ONLY the hands played
-- through that club.
--
-- WHAT HAPPENED, READ FROM ROWS. 28 Bad Beat Jackpot table shares (8,663.26,
-- all horses) earned in hands played through Felt or KINGS were credited to
-- another club's wallet of the same player, and the weekly award reader put
-- each on that club's union statement. A union statement's ECO is
-- round(-0.10 * club profit, 2) per activity and a jackpot share is a player
-- win, so the club the share belongs to was billed 10% too much of it and the
-- club that carried it 10% too little. Recomputed with the hand's earning club
-- (rake_attributions), against the ECO record each statement quotes:
--
--   MIDWAY-2026-000031 Felt,  week of 2026-10-19: profit base 1,278,697.63 -
--     5,648.85 = 1,273,048.78; ECO -127,869.76 -> -127,304.88; owes 564.88 less
--   MIDWAY-2026-000029 KINGS, week of 2026-10-19: 1,306,890.01 - 176.56 =
--     1,306,713.45; ECO -130,689.00 -> -130,671.35; owes 17.65 less
--   MIDWAY-2026-000036 Felt,  week of 2026-10-26: cash base 1,022,192.94 -
--     2,124.83 = 1,020,068.11; cash ECO -102,219.29 -> -102,006.81; owes
--     212.48 less
--   MIDWAY-2026-000039 KINGS, week of 2026-11-02: cash base 33,971.59 - 212.51
--     = 33,759.08; cash ECO -3,397.16 -> -3,375.91; owes 21.25 less
--
-- Each is credited through the union's own credit-note path
-- (fn_union_issue_credit_note: a new numbered document with adjusts_invoice_id,
-- the original statement unchanged). It is delivered by the insert trigger
-- like any statement. A rolled-back probe returned exactly these remaining
-- balances: 127,304.88 / 130,671.35 / 118,743.25 / 6,021.71.
--
-- NOT SETTLED HERE, AND WHY:
--   * MIDWAY-2026-000034 KINGS, week of 2026-10-26: KINGS carried 438.56 of
--     shares that belong to Felt, so it was billed 43.86 too little. The
--     union's only adjustment document is a credit note (a reduction); there
--     is no debit-note path, and adding a charge is not a correction this
--     migration may invent. Recorded in the changelog for the union.
--   * The union house rows (000030, 000035, 000040) are the union's statements
--     to itself; there is no counterparty to settle with.
--   * The chips themselves stay where they were credited: 27 of the 28 wrong
--     wallets no longer hold the share, and taking chips back from a player
--     is never the correction (10.9 rule 3).
--
-- Idempotent: a statement that already carries this credit note is skipped;
-- every figure the arithmetic rests on is asserted first, so the file aborts
-- if any of them moved.
--
-- @live-proof: (SELECT count(*) FROM public.settlement_invoices cn JOIN public.settlement_invoices s ON s.id = cn.adjusts_invoice_id WHERE cn.invoice_type = 'union_weekly_credit_note' AND cn.breakdown->>'reason' LIKE 'Bad Beat Jackpot shares attributed to the club the hand was played through%' AND s.invoice_number IN ('MIDWAY-2026-000029','MIDWAY-2026-000031','MIDWAY-2026-000036','MIDWAY-2026-000039')) = 4

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $settle$
DECLARE
  c_reason constant text := 'Bad Beat Jackpot shares attributed to the club the hand was played through (owner rule 2026-11-15; audit D1, fix 20261115150131). ECO recomputed at 10% of the corrected club profit: ';
  r record; v_id uuid; v jsonb;
BEGIN
  -- The ECO records each statement quotes are unchanged.
  IF (SELECT count(*) FROM public.union_eco_ledger l
       WHERE l.union_id = 'fade0000-0000-0000-0000-000000000001'
         AND l.period_start = '2026-10-19 07:00:00+00' AND l.period_end = '2026-10-26 07:00:00+00'
         AND ((l.club_id = 'a0000000-0000-0000-0000-000000000001' AND l.eco_base = 1278697.63 AND l.eco_amount = -127869.76)
           OR (l.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4' AND l.eco_base = 1306890.01 AND l.eco_amount = -130689.00))
         AND l.eco_rate = 0.10) <> 2 THEN
    RAISE EXCEPTION 'JACKPOT_CREDIT_ECO_RECORD_CHANGED: week of 2026-10-19' USING ERRCODE = '55000';
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('MIDWAY-2026-000031', 'a0000000-0000-0000-0000-000000000001'::uuid, 127869.76::numeric, 564.88::numeric, 127304.88::numeric, NULL::numeric,
       'Felt, week of 2026-10-19: club profit 1,278,697.63 less 5,648.85 of jackpot shares = 1,273,048.78; ECO 127,869.76 -> 127,304.88.'),
      ('MIDWAY-2026-000029', 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, 130689.00, 17.65, 130671.35, NULL,
       'KINGS, week of 2026-10-19: club profit 1,306,890.01 less 176.56 of jackpot shares = 1,306,713.45; ECO 130,689.00 -> 130,671.35.'),
      ('MIDWAY-2026-000036', 'a0000000-0000-0000-0000-000000000001'::uuid, 118955.73, 212.48, 118743.25, 1022192.94,
       'Felt, week of 2026-10-26: cash profit 1,022,192.94 less 2,124.83 of jackpot shares = 1,020,068.11; cash ECO 102,219.29 -> 102,006.81.'),
      ('MIDWAY-2026-000039', 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, 6042.96, 21.25, 6021.71, 33971.59,
       'KINGS, week of 2026-11-02: cash profit 33,971.59 less 212.51 of jackpot shares = 33,759.08; cash ECO 3,397.16 -> 3,375.91.')
    ) x(num, club, net, credit, remaining, cash_base, detail) LOOP
    SELECT s.id INTO v_id FROM public.settlement_invoices s
     WHERE s.invoice_number = r.num AND s.club_id = r.club
       AND s.invoice_type = 'union_weekly_squareup' AND s.from_entity_type = 'club'
       AND s.breakdown->>'union_id' = 'fade0000-0000-0000-0000-000000000001'
       AND s.net_amount = r.net AND s.status = 'generated';
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'JACKPOT_CREDIT_STATEMENT_CHANGED: %', r.num USING ERRCODE = '55000';
    END IF;
    IF r.cash_base IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.settlement_invoices s, jsonb_array_elements(s.breakdown->'eco_components') c
          WHERE s.id = v_id AND c->>'activity' = 'cash' AND (c->>'base')::numeric = r.cash_base
            AND (c->>'rate')::numeric = 0.10) THEN
      RAISE EXCEPTION 'JACKPOT_CREDIT_ECO_COMPONENT_CHANGED: %', r.num USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.settlement_invoices cn
                WHERE cn.adjusts_invoice_id = v_id AND cn.invoice_type = 'union_weekly_credit_note'
                  AND cn.breakdown->>'reason' LIKE 'Bad Beat Jackpot shares attributed to the club the hand was played through%') THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.settlement_invoices cn
                WHERE cn.adjusts_invoice_id = v_id AND cn.invoice_type = 'union_weekly_credit_note') THEN
      RAISE EXCEPTION 'JACKPOT_CREDIT_OTHER_CREDIT_EXISTS: %', r.num USING ERRCODE = '55000';
    END IF;
    v := public.fn_union_issue_credit_note(v_id, r.credit, c_reason || r.detail, false);
    IF (v->>'remaining_after')::numeric IS DISTINCT FROM r.remaining THEN
      RAISE EXCEPTION 'JACKPOT_CREDIT_REMAINDER: % %', r.num, v USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$settle$;

COMMIT;
