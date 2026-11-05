-- 20261105130850_the_conservation_books_read_owner_transfers_and_where_a_tick.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('A REDEEMED TICKET ARRIVES WHERE IT WAS REDEEMED' in pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure)) > 0 AND position('A REDEEMED TICKET ARRIVES WHERE IT WAS REDEEMED' in pg_get_functiondef('public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0
--
-- THE CONSERVATION BOOKS READ OWNER TRANSFERS AND WHERE A TICKET WAS REDEEMED
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- On 2026-11-05 113 'fn_tournament_money_conservation' alerts were open. Every
-- one of those events balances on its own chip_ledger, and every escrow reads
-- 0.00. The detector (fn_tournament_conservation_delta and its one-pass twin
-- fn_tournament_conservation_deltas) did not read three kinds of leg:
--
--   1. OWNER RETIREMENT TRANSFERS. 108 cancelled events (71 SNGs, 35
--      satellites, 2 freezeouts) were closed by the owner-directed retirement
--      of 2026-11-02 (smarter_private.owner_retirement_transfer_pools): what
--      was left in each pool moved prize_liability -> union_bank as one
--      'transfer' leg keyed 'owner-retirement-pool:<event>:<operation>'. The
--      detector saw the entries and the rake, never the transfer, and read
--      every one as "retained money it never paid out" (+15,841.40 in all).
--   2. THE OWNER BOUNTY GUARANTEE CORRECTION. "40 Chip Bounty Freezeout - 5K
--      GTD" (6b72abc3) returned 950.00 of overlay prize_liability ->
--      union_bank as a 'reversal' of kind 'owner_bounty_guarantee_correction'.
--      Only 'reviewed_void_overlay_return' reversals were read: +950.00.
--   3. A TICKET REDEEMED SOMEWHERE OTHER THAN ITS TARGET. A satellite ticket
--      with redemption_mode 'tournament_entry_only' enters any event through a
--      'ticket_redeem' leg escrow -> prize_liability ('tournament_entry_
--      ticket_admission', keyed 'ticket:<ticket>:tournament:<event>:entry').
--      The detector credited the ticket's value to the satellite's TARGET as
--      seat income and never credited the event it was redeemed into. Four
--      tickets from "Prime Time Main Event" satellites were redeemed into
--      "Wednesday Feature": Prime Time read +120.00, Wednesday Feature -120.00.
--      Two "40 Chip Freezeout" tickets redeemed into "40 Chip Bounty
--      Freezeout" (c111d1cb) read +80.00 / -80.00.
--
-- THE FIX
--
-- Both readings of the books gain the same three terms, so they stay one
-- question:
--   - owner_out: the owner retirement transfer and the owner bounty guarantee
--     correction, out of this event's prize_liability back to the house;
--   - ticket_in: every admission leg into this event;
--   - a ticket that has an admission leg is no longer seat income at its
--     target. The leg is found through the indexed ledger timestamp: it is
--     written in the ticket's redeeming transaction, so its created_at equals
--     tournament_tickets.redeemed_at (true for all 2,081 admission legs), and
--     the key pins it to that ticket.
--
-- Measured before installation with the same terms as read-only queries:
-- over 32,590 events in the last 10 days, 113 flagged became 0 and no event
-- that balanced stopped balancing; across all time, 209 events carry one of
-- the terms, 113 were flagged, 0 remain flagged and 0 changed from balanced.
--
-- No money moves. The open alerts that now read inside tolerance are resolved
-- with a resolution note naming the reason; any alert that still reads outside
-- tolerance stays open.
--
-- Applied to the installed definitions, refusing unless each anchor appears
-- exactly once, so the long functions are not retyped by hand.

BEGIN;

SET LOCAL lock_timeout = '1s';

DO $migration$
DECLARE
  v_marker constant text := 'A REDEEMED TICKET ARRIVES WHERE IT WAS REDEEMED';
  -- Shared by both functions: a ticket with an admission leg is not seat
  -- income at its target; the leg itself is read where it landed.
  v_seat_old constant text :=
    ''':closed-target-cash'' AND cl.category = ''ticket_redeem'')))';
  v_seat_new constant text :=
    ''':closed-target-cash'' AND cl.category = ''ticket_redeem'')'
    || ' AND NOT EXISTS (SELECT 1 FROM public.chip_ledger ad'
    || ' WHERE ad.created_at = k.redeemed_at AND ad.category = ''ticket_redeem'''
    || ' AND ad.idempotency_key LIKE ''ticket:'' || k.id::text || '':tournament:%:entry'')))';
  v_def text;
  v_new text;

  FUNCTION_ONCE constant text := 'anchor not found exactly once; refusing to patch';
BEGIN
  ---------------------------------------------------------------------------
  -- The scalar.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure);
  IF position(v_marker IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_seat_old, ''))) / length(v_seat_old) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_delta seat %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_def, v_seat_old, v_seat_new);

    IF (length(v_new) - length(replace(v_new,
          E'AS seat_paid_out\n    FROM public.tournaments t WHERE t.id = p_tournament_id\n', '')))
       / length(E'AS seat_paid_out\n    FROM public.tournaments t WHERE t.id = p_tournament_id\n') <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_delta columns %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_new,
      E'AS seat_paid_out\n    FROM public.tournaments t WHERE t.id = p_tournament_id\n',
      E'AS seat_paid_out,\n'
      || E'      -- A REDEEMED TICKET ARRIVES WHERE IT WAS REDEEMED (2026-11-05). An\n'
      || E'      -- entry-only ticket enters an event through an admission leg; that\n'
      || E'      -- event is credited here and the target no longer counts it above.\n'
      || E'      COALESCE((SELECT sum(x.amount) FROM public.chip_ledger x\n'
      || E'         WHERE x.tournament_id = t.id AND x.category = ''ticket_redeem''\n'
      || E'           AND x.to_type = ''prize_liability''\n'
      || E'           AND x.metadata->>''kind'' = ''tournament_entry_ticket_admission''), 0) AS ticket_in,\n'
      || E'      -- OWNER-DIRECTED RETURNS TO THE HOUSE (2026-11-05): the retirement\n'
      || E'      -- transfer and the bounty guarantee correction leave the pool.\n'
      || E'      COALESCE((SELECT sum(x.amount) FROM public.chip_ledger x\n'
      || E'         WHERE x.tournament_id = t.id AND x.from_type = ''prize_liability''\n'
      || E'           AND x.from_entity_id = t.id AND x.to_type IN (''union_bank'',''club_treasury'')\n'
      || E'           AND ((x.category = ''transfer'' AND x.idempotency_key LIKE ''owner-retirement-pool:%'')\n'
      || E'             OR (x.category = ''reversal'' AND x.metadata->>''kind'' = ''owner_bounty_guarantee_correction''))), 0) AS owner_out\n'
      || E'    FROM public.tournaments t WHERE t.id = p_tournament_id\n');

    IF (length(v_new) - length(replace(v_new, E'    - m.seat_paid_out\n', '')))
       / length(E'    - m.seat_paid_out\n') <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_delta arithmetic %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_new, E'    - m.seat_paid_out\n',
      E'    - m.seat_paid_out\n    + m.ticket_in\n    - m.owner_out\n');
    EXECUTE v_new;
  END IF;

  ---------------------------------------------------------------------------
  -- The one-pass set function: the same three terms, summed once per table.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef(
    'public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure);
  IF position(v_marker IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_seat_old, ''))) / length(v_seat_old) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas seat %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_def, v_seat_old, v_seat_new);

    IF (length(v_new) - length(replace(v_new, E'\n  )\n  SELECT e.id, e.name, e.variant, e.ended_at,\n', '')))
       / length(E'\n  )\n  SELECT e.id, e.name, e.variant, e.ended_at,\n') <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas ctes %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_new, E'\n  )\n  SELECT e.id, e.name, e.variant, e.ended_at,\n',
      E'\n  ), ticket_in AS MATERIALIZED (\n'
      || E'    -- A REDEEMED TICKET ARRIVES WHERE IT WAS REDEEMED (2026-11-05): see the scalar.\n'
      || E'    SELECT x.tournament_id AS id, sum(x.amount) AS amount\n'
      || E'    FROM public.chip_ledger x JOIN eligible e ON e.id = x.tournament_id\n'
      || E'    WHERE x.category = ''ticket_redeem'' AND x.to_type = ''prize_liability''\n'
      || E'      AND x.metadata->>''kind'' = ''tournament_entry_ticket_admission''\n'
      || E'    GROUP BY x.tournament_id\n'
      || E'  ), owner_out AS MATERIALIZED (\n'
      || E'    -- OWNER-DIRECTED RETURNS TO THE HOUSE (2026-11-05): see the scalar.\n'
      || E'    SELECT x.tournament_id AS id, sum(x.amount) AS amount\n'
      || E'    FROM public.chip_ledger x JOIN eligible e ON e.id = x.tournament_id\n'
      || E'    WHERE x.from_type = ''prize_liability'' AND x.from_entity_id = x.tournament_id\n'
      || E'      AND x.to_type IN (''union_bank'',''club_treasury'')\n'
      || E'      AND ((x.category = ''transfer'' AND x.idempotency_key LIKE ''owner-retirement-pool:%'')\n'
      || E'        OR (x.category = ''reversal'' AND x.metadata->>''kind'' = ''owner_bounty_guarantee_correction''))\n'
      || E'    GROUP BY x.tournament_id\n'
      || E'  )\n  SELECT e.id, e.name, e.variant, e.ended_at,\n');

    IF (length(v_new) - length(replace(v_new, '- COALESCE(so.amount, 0), 2) END AS delta', '')))
       / length('- COALESCE(so.amount, 0), 2) END AS delta') <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas arithmetic %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_new, '- COALESCE(so.amount, 0), 2) END AS delta',
      E'- COALESCE(so.amount, 0)\n      + COALESCE(ti.amount, 0) - COALESCE(oo.amount, 0), 2) END AS delta');

    IF (length(v_new) - length(replace(v_new, E'  LEFT JOIN seat_outgoing so ON so.id = e.id\n', '')))
       / length(E'  LEFT JOIN seat_outgoing so ON so.id = e.id\n') <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_conservation_deltas joins %', FUNCTION_ONCE;
    END IF;
    v_new := replace(v_new, E'  LEFT JOIN seat_outgoing so ON so.id = e.id\n',
      E'  LEFT JOIN seat_outgoing so ON so.id = e.id\n'
      || E'  LEFT JOIN ticket_in ti ON ti.id = e.id\n'
      || E'  LEFT JOIN owner_out oo ON oo.id = e.id\n');
    EXECUTE v_new;
  END IF;
END
$migration$;

-- The named events now balance, and both readings agree on them.
DO $assert$
DECLARE
  v_id uuid;
  v_scalar numeric;
  v_set numeric;
BEGIN
  FOREACH v_id IN ARRAY ARRAY[
    '94ef58cf-5f0b-47dd-bbe1-d490e036b083',  -- Wednesday Feature, 4 tickets in
    '34f202b3-fc7a-47c8-8216-af34be5f1601',  -- Prime Time Main Event, 4 tickets out
    'c111d1cb-57c5-46e4-ab82-9a40c899a1ec',  -- 40 Chip Bounty Freezeout, 2 tickets in
    '7e6ec833-ac48-460f-8f26-7f821ea8642d',  -- 40 Chip Freezeout, 2 tickets out
    '6b72abc3-bd16-488c-aea5-54b1eace98d5',  -- owner bounty guarantee correction
    '161b65b2-a718-4fd7-9a6b-f60fbd77a40a'   -- owner retirement transfer
  ]::uuid[] LOOP
    v_scalar := public.fn_tournament_conservation_delta(v_id);
    SELECT d.delta INTO v_set
      FROM public.tournaments t
      CROSS JOIN LATERAL public.fn_tournament_conservation_deltas(
        t.ended_at - interval '1 second', t.ended_at + interval '1 second') d
     WHERE t.id = v_id AND d.id = v_id;
    IF v_scalar IS DISTINCT FROM 0 OR v_set IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'conservation reading for % is scalar % set %', v_id, v_scalar, v_set;
    END IF;
  END LOOP;
END
$assert$;

-- Close the alerts the corrected books show were never real, with the reason.
UPDATE public.financial_alerts fa
   SET resolved = true,
       resolved_at = now(),
       resolution = 'Balanced on the corrected conservation reading (20261105130850): '
         || 'the detector had not read owner retirement transfers, the owner bounty '
         || 'guarantee correction, or a ticket redeemed into an event other than its '
         || 'target. The ledger and escrow balanced throughout; no money moved.'
 WHERE fa.source = 'fn_tournament_money_conservation'
   AND fa.resolved IS NOT TRUE
   AND fa.context->>'tournament_id' IS NOT NULL
   AND abs(public.fn_tournament_conservation_delta((fa.context->>'tournament_id')::uuid)) <= 0.05;

COMMIT;
