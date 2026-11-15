-- 20261115011424_union_invoice_views_show_the_week_and_who_pays
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 01:14:24 UTC.
--
-- OWNER SPECIFICATION (Dan, 2026-11-14, item 8): every one of the five Midway
-- Union weekly invoices for the week ending 2026-11-09 must show the exact
-- week start and end, who issued it and to whom, who pays whom, the comparable
-- fee and player-result components, the settlement offsets and the amount due,
-- at the supported precision; the union's own house row (club_id = union id,
-- 21.25 owed by the union to its house club) is presented separately; and the
-- "already moved in chips" line must stop calling every offset a transfer.
--
-- WHAT WAS WRONG, READ FROM THE INSTALLED FUNCTIONS AND ROWS (2026-11-15):
--
--   * ca_union_statement_board returned the week only as two DATES
--     ((breakdown->>'period_start')::date), so every screen printed
--     "2026-11-02 To 2026-11-09": eight calendar days and no 2 AM boundary.
--     It did not return the invoice number, the payer or payee, the house-row
--     flag, settled_in_chips or player_pnl_net, all of which are stored on
--     the issued invoice (settlement_invoices.breakdown, from/to entity).
--   * fn_deliver_accounting_invoice wrote a union square-up's Messenger body
--     as "Direction: Club To Union", "Period: 2026-11-02T08:00:00+00:00 To
--     2026-11-09T08:00:00+00:00" (UTC text) and appended the stored note
--     "settled_in_chips already moved during the week". settled_in_chips is
--     fn_union_club_invoice's player_pnl_net + rakeback_due. Read-only
--     evidence for the week ending 2026-11-09 (recorded in the PR): the
--     only union-to-club
--     transfers were the three round-1 rakeback legs posted 2026-11-09
--     10:52:00Z (Deep Stack 406,985.78, Felt 409,959.09, Kings 23,268.80);
--     player_pnl_net (players_won plus the fees they paid) was settled at the
--     tables during the week (pots, BBJ drops and awards, tournament entries
--     and prizes). No presettlement or payment exists against any of the
--     five, so each amount due is its recorded ECO. Calling the whole figure
--     "moved" without that split is the misstatement item 7 names.
--   * fn_union_issue_weekly_invoices stores that same note on every new
--     square-up.
--
-- WHAT THIS CHANGES (read-only presentation; no amount, number, status,
-- delivery flag or issued invoice is rewritten, regenerated or resent):
--
--   1. ca_union_statement_board adds, per issued row, invoice_number, the
--      exact period_start_at / period_end_at instants from the stored
--      breakdown, payer/payee type and name (from/to entity), union_house
--      (club_id = union id), settled_in_chips, player_pnl_net, the stored
--      signed outstanding, the credit notes recorded against the invoice and
--      what remains after them (fn_union_invoice_outstanding); and
--      period_start_at / period_end_at for the board and each history
--      period. Every existing key and figure is unchanged.
--   2. smarter_private.union_weekly_invoice_body(invoice) writes the Messenger
--      text for union square-ups and credit notes: the Chicago week line
--      ("Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time",
--      formatted from the stored instants with America/Chicago rules, never
--      by adding 24 hours), issuer, recipient, "<payer> Pays <payee> <amount>
--      Chips" or "Square, Nothing Due", every stored component digit for
--      digit (no to_char rounding), the settled-in-chips split and the
--      amount-due reconciliation; a square-up later reduced by credit notes
--      names them and states only what remains. fn_deliver_accounting_invoice calls it for
--      those two types only; every other document's body is unchanged. The
--      body is computed at delivery time, so this reaches only deliveries
--      made after it is installed. The five rows for the week ending
--      2026-11-09 are message_sent with zero deliveries; nothing here sends
--      them.
--   3. fn_union_issue_weekly_invoices stores an accurate note on future
--      square-ups. Existing notes are left as issued.
--
-- Each function is patched from its installed source under an md5 guard and
-- every anchor must match exactly once; signatures, security, owners and
-- grants are unchanged. The new private helpers are not executable by
-- PUBLIC, anon or authenticated (smarter_private grants USAGE to both).
-- Function-only: no table DDL, no hot-table lock, no engine dependency.
--
-- @live-proof: position('period_start_at' IN pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure))>0 AND position('smarter_private.union_weekly_invoice_body(inv.id)' IN pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))>0 AND position('settled_in_chips already moved' IN pg_get_functiondef('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)'::regprocedure))=0 AND to_regprocedure('smarter_private.union_weekly_invoice_body(uuid)') IS NOT NULL

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- -----------------------------------------------------------------------------
-- Helpers: an exact figure, a Chicago instant and the Chicago week line.
-- -----------------------------------------------------------------------------

-- Digits copied from the numeric: grouped, at least two places, every stored
-- decimal kept. to_char(x,'FM...0.00') rounds past the second place.
CREATE OR REPLACE FUNCTION smarter_private.union_statement_figure(p numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN p IS NULL THEN 'Unavailable' ELSE
    CASE WHEN p < 0 THEN '-' ELSE '' END
    || regexp_replace(trunc(abs(p))::text, '(\d)(?=(\d{3})+$)', '\1,', 'g')
    || '.' || (SELECT f || repeat('0', greatest(0, 2 - length(f)))
                 FROM (SELECT rtrim(split_part(abs(p)::text, '.', 2), '0') AS f) x)
  END
$function$;

-- A stored breakdown figure: a jsonb number printed exactly, anything else
-- 'Unavailable'. A malformed breakdown never aborts a delivery.
CREATE OR REPLACE FUNCTION smarter_private.union_statement_amount(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN jsonb_typeof(p) = 'number'
    THEN smarter_private.union_statement_figure((p #>> '{}')::numeric)
    ELSE 'Unavailable' END
$function$;

-- "Mon Nov 2, 2026 2:00 AM" in America/Chicago, from the stored instant.
CREATE OR REPLACE FUNCTION smarter_private.union_statement_instant(p timestamptz)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN p IS NULL THEN 'Unavailable'
    ELSE to_char(p AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD, YYYY FMHH12:MI AM') END
$function$;

-- The accounting week [start, end): the start is included, the end is not.
CREATE OR REPLACE FUNCTION smarter_private.union_statement_week(p_start timestamptz, p_end timestamptz)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN p_start IS NULL OR p_end IS NULL THEN 'Unavailable'
    ELSE smarter_private.union_statement_instant(p_start) || ' to '
      || smarter_private.union_statement_instant(p_end) || ' Chicago Time' END
$function$;

-- -----------------------------------------------------------------------------
-- The Messenger body of a union square-up or credit note.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.union_weekly_invoice_body(p_invoice_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  inv public.settlement_invoices%ROWTYPE;
  b jsonb;
  w jsonb;
  c jsonb;
  v_union uuid;
  v_union_name text;
  v_club_name text;
  v_house boolean;
  v_payer text;
  v_payee text;
  v_start timestamptz;
  v_end timestamptz;
  v_square boolean;
  v_body text;
  v_original text;
  v_credits text;
  v_credited numeric;
  v_remaining numeric;
BEGIN
  SELECT * INTO inv FROM public.settlement_invoices s WHERE s.id = p_invoice_id;
  IF NOT FOUND OR inv.invoice_type NOT IN ('union_weekly_squareup', 'union_weekly_credit_note') THEN
    RAISE EXCEPTION 'union_weekly_invoice_body_wrong_document' USING ERRCODE = '23514';
  END IF;
  b := COALESCE(inv.breakdown, '{}'::jsonb);
  v_union := CASE WHEN pg_input_is_valid(b->>'union_id', 'uuid') THEN (b->>'union_id')::uuid END;
  v_union_name := COALESCE((SELECT u.name FROM public.unions u WHERE u.id = v_union),
                           b->>'union_name', 'The Union');
  v_club_name := COALESCE((SELECT cl.name FROM public.clubs cl WHERE cl.id = inv.club_id),
                          b->>'club_name', 'The Club');
  v_house := inv.club_id IS NOT DISTINCT FROM v_union;
  v_start := CASE WHEN pg_input_is_valid(b->>'period_start', 'timestamptz')
                  THEN (b->>'period_start')::timestamptz END;
  v_end := CASE WHEN pg_input_is_valid(b->>'period_end', 'timestamptz')
                THEN (b->>'period_end')::timestamptz END;
  v_payer := CASE inv.from_entity_type
    WHEN 'union' THEN (SELECT u.name FROM public.unions u
                        WHERE u.id = CASE WHEN pg_input_is_valid(inv.from_entity_id, 'uuid') THEN inv.from_entity_id::uuid END)
    WHEN 'club' THEN (SELECT cl.name FROM public.clubs cl
                       WHERE cl.id = CASE WHEN pg_input_is_valid(inv.from_entity_id, 'uuid') THEN inv.from_entity_id::uuid END)
      || CASE WHEN v_house THEN ' (House Club)' ELSE '' END
  END;
  v_payee := CASE inv.to_entity_type
    WHEN 'union' THEN (SELECT u.name FROM public.unions u
                        WHERE u.id = CASE WHEN pg_input_is_valid(inv.to_entity_id, 'uuid') THEN inv.to_entity_id::uuid END)
    WHEN 'club' THEN (SELECT cl.name FROM public.clubs cl
                       WHERE cl.id = CASE WHEN pg_input_is_valid(inv.to_entity_id, 'uuid') THEN inv.to_entity_id::uuid END)
      || CASE WHEN v_house THEN ' (House Club)' ELSE '' END
  END;
  v_payer := COALESCE(v_payer, initcap(inv.from_entity_type));
  v_payee := COALESCE(v_payee, initcap(inv.to_entity_type));

  IF inv.invoice_type = 'union_weekly_credit_note' THEN
    SELECT o.invoice_number INTO v_original FROM public.settlement_invoices o
     WHERE o.id = CASE WHEN pg_input_is_valid(b->>'original_invoice_id', 'uuid')
                       THEN (b->>'original_invoice_id')::uuid END;
    RETURN v_union_name || ' Credit Note ' || COALESCE(inv.invoice_number, '')
      || E'\nAgainst Invoice: ' || COALESCE(v_original, b->>'credit_note_for', 'Unavailable')
      || E'\nWeek: ' || smarter_private.union_statement_week(v_start, v_end)
      || E'\nThe Week Includes Its Start And Excludes Its End.'
      || E'\nIssued By: ' || v_union_name
      || E'\nIssued To: ' || v_club_name
      || CASE WHEN v_house THEN ' (The Union''s Own House Club)' ELSE '' END
      || E'\nCredit: ' || v_payer || ' Credits ' || v_payee || ' '
      || smarter_private.union_statement_figure(abs(inv.net_amount)) || ' Chips'
      || E'\nA Credit Note Reduces The Original Invoice. No Chips Move.'
      || E'\nStatus: ' || initcap(inv.status)
      || CASE WHEN b ? 'reason' THEN E'\nReason: ' || (b->>'reason') ELSE '' END;
  END IF;

  -- A square-up later reduced by credit notes owes only what is left
  -- (fn_union_invoice_outstanding's rule): it never reads as the full amount.
  SELECT string_agg(cn.invoice_number || ' (' || smarter_private.union_statement_figure(cn.net_amount) || ')',
                    ', ' ORDER BY cn.created_at, cn.invoice_number),
         sum(cn.net_amount)
    INTO v_credits, v_credited
    FROM public.settlement_invoices cn
   WHERE cn.adjusts_invoice_id = inv.id AND cn.invoice_type = 'union_weekly_credit_note';
  v_remaining := round(abs(inv.net_amount) - COALESCE(v_credited, 0), 2);
  v_square := COALESCE(round(inv.net_amount, 2) = 0, false) OR COALESCE(b->>'direction', '') = 'square';
  v_body := v_union_name
      || CASE WHEN v_house THEN ' House Club Statement ' ELSE ' Weekly Statement ' END
      || COALESCE(inv.invoice_number, '')
    || E'\nWeek: ' || smarter_private.union_statement_week(v_start, v_end)
    || E'\nThe Week Includes Its Start And Excludes Its End.'
    || E'\nIssued By: ' || v_union_name
    || E'\nIssued To: ' || v_club_name
    || CASE WHEN v_house THEN ' (The Union''s Own House Club)' ELSE '' END
    || E'\nAmount Due: '
    || CASE WHEN v_square THEN 'Square, Nothing Due'
            WHEN v_credits IS NOT NULL AND v_remaining <= 0
              THEN 'Credited In Full, Nothing Due'
            WHEN v_credits IS NOT NULL
              THEN v_payer || ' Pays ' || v_payee || ' '
                || smarter_private.union_statement_figure(v_remaining) || ' Chips After Credit'
            ELSE v_payer || ' Pays ' || v_payee || ' '
              || smarter_private.union_statement_figure(abs(inv.net_amount)) || ' Chips' END
    || CASE WHEN v_credits IS NOT NULL
            THEN E'\nOriginal Amount: ' || smarter_private.union_statement_figure(abs(inv.net_amount))
              || E'\nCredited By: ' || v_credits
            ELSE '' END
    || E'\nStatus: ' || initcap(inv.status)
    || CASE WHEN inv.due_at IS NOT NULL AND NOT v_square AND v_remaining > 0
            THEN E'\nDue: ' || smarter_private.union_statement_instant(inv.due_at) || ' Chicago Time'
            ELSE '' END
    || E'\n'
    || E'\nRake Generated: ' || smarter_private.union_statement_amount(b->'rake_generated')
    || E'\nUnion Fee Kept: ' || smarter_private.union_statement_amount(b->'union_fee_kept')
    || E'\nRakeback Paid To The Club: ' || smarter_private.union_statement_amount(b->'rakeback_due')
    || E'\nPlayer Win/Loss, Fees Paid Included (Negative Means Players Lost): '
      || smarter_private.union_statement_amount(b->'players_won')
    || CASE WHEN b ? 'player_pnl_net'
            THEN E'\nPlayer Result Excluding Fees: '
              || smarter_private.union_statement_amount(b->'player_pnl_net')
              || E'\nThe Two Player Figures Differ By Exactly The Rake Generated; Neither Is An Amount Due.'
            ELSE '' END;

  w := b->'weekly_player_results';
  IF jsonb_typeof(w) = 'object' THEN
    v_body := v_body
      || E'\nThe Lines Below Are Counted From The Club''s Side: Positive Means Players Lost Or The Club Pays.'
      || E'\nCash Player Net Loss: ' || smarter_private.union_statement_amount(w->'cash_net_loss')
      || E'\nTournament Player Net Loss: ' || smarter_private.union_statement_amount(w->'tournament_net_loss')
      || E'\nTotal Player Net Loss: ' || smarter_private.union_statement_amount(w->'total_net_loss')
      || E'\nLess Club Rakeback Credit: ' || smarter_private.union_statement_amount(w->'rakeback_credit')
      || E'\nECO Charge Or Credit (Positive Means The Club Pays): ' || smarter_private.union_statement_amount(w->'eco_charge')
      || E'\nFull Weekly Net (Positive Club Owes Union): '
        || smarter_private.union_statement_amount(w->'weekly_net_due_to_union')
      || E'\nThe Full Weekly Net Is Counted From The Club''s Side And Includes The Fees Players Paid. '
      || 'It Is A Summary, Not An Additional Payment Request.';
  ELSE
    v_body := v_body || E'\nCash And Tournament Player Split: Not Recorded On This Invoice';
  END IF;

  IF b->'eco_version' = '2'::jsonb AND jsonb_typeof(b->'eco_components') = 'array' THEN
    FOR c IN SELECT e.value FROM jsonb_array_elements(b->'eco_components') e
              ORDER BY CASE e.value->>'activity' WHEN 'cash' THEN 0 ELSE 1 END LOOP
      v_body := v_body || E'\n' || initcap(COALESCE(c->>'activity', 'Other')) || ' ECO: '
        || smarter_private.union_statement_amount(c->'amount')
        || ' (Base ' || smarter_private.union_statement_amount(c->'base')
        || ' At ' || CASE WHEN jsonb_typeof(c->'rate') = 'number'
                          THEN trim_scale((c->>'rate')::numeric * 100)::text || '%)'
                          ELSE 'Unavailable Rate)' END;
    END LOOP;
  END IF;

  v_body := v_body
    || E'\nCombined ECO (Negative Means The Club Pays): '
      || smarter_private.union_statement_amount(b->'eco_amount')
    || E'\nRecorded Presettlements: ' || smarter_private.union_statement_amount(b->'presettled')
    || CASE WHEN b ? 'settled_in_chips' THEN
         E'\nSettled In Chips: ' || smarter_private.union_statement_amount(b->'settled_in_chips')
         || CASE WHEN jsonb_typeof(b->'rakeback_due') = 'number' AND (b->>'rakeback_due')::numeric <> 0
                 THEN E'\n  Rakeback Paid By ' || v_union_name || ' To ' || v_club_name
                   || ' With The Monday Rakeback: '
                   || smarter_private.union_statement_amount(b->'rakeback_due')
                   || ' (The Only Union To Club Transfer In It)'
                 ELSE E'\n  No Rakeback Was Paid To The Club For This Week' END
         || CASE WHEN b ? 'player_pnl_net' THEN
              E'\n  Player Result Excluding Fees: '
              || smarter_private.union_statement_amount(b->'player_pnl_net')
              || ' (Already Settled At The Tables During The Week: Pots, Bad Beat Jackpot Drops And Awards, '
              || 'Tournament Entries And Prizes; Not A Union Or Club Transfer)'
            ELSE '' END
         || E'\nSettled In Chips Has Already Moved And Is Not Billed Again.'
       ELSE '' END
    || CASE WHEN b ? 'outstanding' THEN
         E'\nAmount Due Is What Remains: Combined ECO '
           || smarter_private.union_statement_amount(b->'eco_amount')
           || ' Plus Recorded Presettlements '
           || smarter_private.union_statement_amount(b->'presettled')
           || ' Equals ' || smarter_private.union_statement_amount(b->'outstanding')
           || ' (Negative: The Club Pays The Union; Positive: The Union Pays The Club)'
           || CASE WHEN v_credits IS NOT NULL
                   THEN E'\nLess Credit Notes ' || smarter_private.union_statement_figure(COALESCE(v_credited, 0))
                     || ' Leaves ' || smarter_private.union_statement_figure(greatest(v_remaining, 0)) || ' Due'
                   ELSE '' END
       ELSE '' END;
  RETURN v_body;
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.union_statement_figure(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.union_statement_amount(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.union_statement_instant(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.union_statement_week(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.union_weekly_invoice_body(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.union_statement_figure(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.union_statement_amount(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.union_statement_instant(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.union_statement_week(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.union_weekly_invoice_body(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- Patch installed functions: the source must be the reviewed one, and every
-- anchor must occur exactly once.
-- -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.ca_patch(p_fn regprocedure, p_md5 text, p_pairs text[])
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i int;
BEGIN
  IF md5(d) <> p_md5 THEN RAISE EXCEPTION 'UNION_INVOICE_VIEWS_SOURCE_CHANGED: %', p_fn; END IF;
  FOR i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    IF (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]) <> 1 THEN
      RAISE EXCEPTION 'UNION_INVOICE_VIEWS_ANCHOR_NOT_UNIQUE in %: %', p_fn, p_pairs[i];
    END IF;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  END LOOP;
  EXECUTE d;
END
$patch$;

-- 1. The board carries the stored week instants, the parties and the split.
SELECT pg_temp.ca_patch(
  'public.ca_union_statement_board(uuid,date,integer)'::regprocedure,
  'e435e7955327da160148245b4d3e0d75',
  ARRAY[
    $a$           i.breakdown->'weekly_player_results' AS weekly_player_results,
$a$,
    $a$           i.breakdown->'weekly_player_results' AS weekly_player_results,
           i.invoice_number,
           CASE WHEN pg_input_is_valid(i.breakdown->>'period_start', 'timestamptz')
                THEN (i.breakdown->>'period_start')::timestamptz END AS period_start_at,
           CASE WHEN pg_input_is_valid(i.breakdown->>'period_end', 'timestamptz')
                THEN (i.breakdown->>'period_end')::timestamptz END AS period_end_at,
           i.from_entity_type AS payer_type,
           CASE i.from_entity_type
             WHEN 'union' THEN (SELECT u.name FROM unions u WHERE u.id = CASE WHEN pg_input_is_valid(i.from_entity_id, 'uuid') THEN i.from_entity_id::uuid END)
             WHEN 'club' THEN (SELECT pc.name FROM clubs pc WHERE pc.id = CASE WHEN pg_input_is_valid(i.from_entity_id, 'uuid') THEN i.from_entity_id::uuid END)
           END AS payer_name,
           i.to_entity_type AS payee_type,
           CASE i.to_entity_type
             WHEN 'union' THEN (SELECT u.name FROM unions u WHERE u.id = CASE WHEN pg_input_is_valid(i.to_entity_id, 'uuid') THEN i.to_entity_id::uuid END)
             WHEN 'club' THEN (SELECT pc.name FROM clubs pc WHERE pc.id = CASE WHEN pg_input_is_valid(i.to_entity_id, 'uuid') THEN i.to_entity_id::uuid END)
           END AS payee_name,
           (cu.club_id = p_union_id) AS union_house,
           CASE WHEN jsonb_typeof(i.breakdown->'settled_in_chips') = 'number'
                THEN (i.breakdown->>'settled_in_chips')::numeric END AS settled_in_chips,
           CASE WHEN jsonb_typeof(i.breakdown->'player_pnl_net') = 'number'
                THEN (i.breakdown->>'player_pnl_net')::numeric END AS player_pnl_net,
           CASE WHEN jsonb_typeof(i.breakdown->'outstanding') = 'number'
                THEN (i.breakdown->>'outstanding')::numeric END AS stored_outstanding,
           (SELECT jsonb_agg(jsonb_build_object('invoice_number', cn.invoice_number,
                                                'amount', round(cn.net_amount, 2))
                             ORDER BY cn.created_at, cn.invoice_number)
              FROM settlement_invoices cn
             WHERE cn.adjusts_invoice_id = i.id
               AND cn.invoice_type = 'union_weekly_credit_note') AS credit_notes,
           CASE WHEN i.id IS NOT NULL THEN public.fn_union_invoice_outstanding(i.id) END AS remaining_after_credits,
$a$,
    $a$'weekly_player_results',b.weekly_player_results,$a$,
    $a$'weekly_player_results',b.weekly_player_results,
               'invoice_number', b.invoice_number,
               'period_start_at', b.period_start_at, 'period_end_at', b.period_end_at,
               'payer_type', b.payer_type, 'payer_name', b.payer_name,
               'payee_type', b.payee_type, 'payee_name', b.payee_name,
               'union_house', b.union_house,
               'settled_in_chips', round(b.settled_in_chips, 2),
               'player_pnl_net', round(b.player_pnl_net, 2),
               'stored_outstanding', round(b.stored_outstanding, 2),
               'credit_notes', b.credit_notes,
               'remaining_after_credits', round(b.remaining_after_credits, 2),$a$,
    $a$    'period_start', (SELECT MIN((i.breakdown->>'period_start')::date) FROM period_invoices i),
$a$,
    $a$    'period_start', (SELECT MIN((i.breakdown->>'period_start')::date) FROM period_invoices i),
    'period_start_at', (SELECT MIN(b.period_start_at) FROM board b),
    'period_end_at', (SELECT MAX(b.period_end_at) FROM board b),
$a$,
    $a$           MIN((s.breakdown->>'period_start')::date) AS period_start,
$a$,
    $a$           MIN((s.breakdown->>'period_start')::date) AS period_start,
           MIN(CASE WHEN pg_input_is_valid(s.breakdown->>'period_start', 'timestamptz')
                    THEN (s.breakdown->>'period_start')::timestamptz END) AS period_start_at,
           MAX(CASE WHEN pg_input_is_valid(s.breakdown->>'period_end', 'timestamptz')
                    THEN (s.breakdown->>'period_end')::timestamptz END) AS period_end_at,
$a$,
    $a$'period_start', h.period_start, 'period_end', h.period_end,$a$,
    $a$'period_start', h.period_start, 'period_end', h.period_end,
               'period_start_at', h.period_start_at, 'period_end_at', h.period_end_at,$a$
  ]);

-- 2. A union square-up or credit note is delivered with its own body. Every
--    other document keeps the body it had.
SELECT pg_temp.ca_patch(
  'public.fn_deliver_accounting_invoice(uuid)'::regprocedure,
  'c33ff353ae9ded41301fea2a25f670e4',
  ARRAY[
    $a$ IF inv.invoice_type='credit_limit_change' THEN body:=public.fn_accounting_credit_change_body_v1($a$,
    $a$ IF inv.invoice_type IN('union_weekly_squareup','union_weekly_credit_note') THEN body:=smarter_private.union_weekly_invoice_body(inv.id);
 ELSIF inv.invoice_type='credit_limit_change' THEN body:=public.fn_accounting_credit_change_body_v1($a$
  ]);

-- 3. Future square-ups store an accurate note. Issued notes stay as issued.
SELECT pg_temp.ca_patch(
  'public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)'::regprocedure,
  '4a549e6a01520cefce1d103d9eb6e2ee',
  ARRAY[
    $a$      'Weekly union square-up. settled_in_chips already moved during the week; '
      || 'outstanding is the amount to settle.'$a$,
    $a$      'Weekly union square-up. Settled in chips is the Monday rakeback the union paid the club '
      || 'plus the player result excluding fees, which was already settled at the tables and is not '
      || 'a union or club transfer; neither part is billed again. Outstanding (ECO plus recorded '
      || 'presettlements) is what remains to settle.'$a$
  ]);

DROP FUNCTION pg_temp.ca_patch(regprocedure, text, text[]);

DO $verify$
BEGIN
  IF position('period_start_at' IN pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure)) = 0
     OR position('smarter_private.union_weekly_invoice_body(inv.id)' IN pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure)) = 0
     OR position('settled_in_chips already moved' IN pg_get_functiondef('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'UNION_INVOICE_VIEWS_INSTALL_MISMATCH';
  END IF;
END
$verify$;

COMMIT;
