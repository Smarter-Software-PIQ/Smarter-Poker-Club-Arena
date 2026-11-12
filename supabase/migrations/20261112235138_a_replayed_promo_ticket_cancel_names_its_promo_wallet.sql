-- A REPLAYED PROMO TICKET CANCEL NAMES ITS PROMO WALLET.
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Follow-up to 20261112184216 (promo funded cashier tickets), found in review.
-- fn_cancel_tournament_ticket answers a retry of an already cancelled ticket
-- from its receipt. That answer carried no refund_wallet, so the cashier told
-- the issuer of a promo ticket the chips were "Back In Your Balance" when they
-- are back in the promo wallet. The receipt already records refund_wallet;
-- the replay now returns it. An issuer who no longer holds a promo wallet row
-- is also told that, instead of being told they left the club. Nothing about
-- which balance moves, or when, changes.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure)) = '25b182e8905f859ba5de2467957a4eda')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE
  d text := pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure);
  n text;
BEGIN
  IF md5(d) <> '7b73f81407a4feb9084b92d5ee38db1d' THEN
    RAISE EXCEPTION 'Unexpected ticket cancel preimage';
  END IF;
  n := replace(d, '        ''your_balance'',(v_receipt.metadata->>''issuer_balance_after'')::numeric,
        ''transaction_id'',v_receipt.id);',
'        ''your_balance'',(v_receipt.metadata->>''issuer_balance_after'')::numeric,
        ''transaction_id'',v_receipt.id,
        ''refund_wallet'',COALESCE(v_receipt.metadata->>''refund_wallet'',''player_wallet''));');
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel replay patch did not match'; END IF;
  d := n;
  n := replace(d, '      ''error'',''You Are No Longer A Member Of That Club, So The Escrow Has Nowhere To Land'');',
'      ''error'',CASE WHEN v_promo
        THEN ''You No Longer Hold A Promo Wallet In That Club, So The Escrow Has Nowhere To Land''
        ELSE ''You Are No Longer A Member Of That Club, So The Escrow Has Nowhere To Land'' END);');
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel promo message patch did not match'; END IF;
  EXECUTE n;
END
$patch$;

COMMIT;
