-- 20261108155826_welcome_jackpot_returns_name_their_source_bank
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 15:58:26 UTC.
--
-- The welcome reset returns the pristine main jackpot seed to the club.
-- Its single journal leg is written by the treasury trigger. Name the source
-- bank so balance replay sees the debit on the same leg as the credit.
-- Production reset 6b535141-8015-45f9-8302-9bc7adbc9667 returned 100 chips,
-- but ledger leg 951c7948-a3e4-4fa6-9d00-77fc970d2b92 omitted the source label.
-- The PostgreSQL welcome-reset regression exercises that shape before and
-- after the change and checks that replaying the reset creates no extra leg.
-- @live-proof: position('WHEN cp = ''bbj_pool'' AND cplbl = ''bbj_pools.main_balance'' THEN cplbl' IN pg_get_functiondef('public.fn_ca_autoledger()'::regprocedure)) > 0 AND position('PERFORM set_config(''app.ledger_counterparty_label'', ''bbj_pools.main_balance'', true)' IN pg_get_functiondef('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  autoledger_def text := pg_get_functiondef('public.fn_ca_autoledger()'::regprocedure);
  unwind_def text := pg_get_functiondef('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)'::regprocedure);
  label_anchor constant text := $anchor$    WHEN cp = 'union_wallet' AND cplbl LIKE 'union_wallets.%' THEN cplbl$anchor$;
  declaration_anchor constant text := $anchor$  PERFORM public.fn_ca_declare_ledger('treasury_transfer','bbj_pool',v_bbj.id,
    NULL,NULL,ARRAY['bbj_pools']);$anchor$;
  transfer_anchor constant text := declaration_anchor || E'\n' || $anchor$  v_after:=public.fn_spin_move_owner_wallet(p_club_id,'club','chip_treasury',v_bbj_funding);$anchor$;
BEGIN
  IF cardinality(string_to_array(autoledger_def, label_anchor)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(unwind_def, transfer_anchor)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WELCOME_BBJ_JOURNAL_PREIMAGE_CHANGED';
  END IF;

  EXECUTE replace(autoledger_def, label_anchor, label_anchor || E'\n'
    || $patch$    WHEN cp = 'bbj_pool' AND cplbl = 'bbj_pools.main_balance' THEN cplbl$patch$);

  EXECUTE replace(unwind_def, transfer_anchor,
    declaration_anchor || E'\n'
    || $patch$  PERFORM set_config('app.ledger_counterparty_label', 'bbj_pools.main_balance', true);$patch$
    || E'\n' || substr(transfer_anchor, length(declaration_anchor) + 2));
END
$migration$;

SELECT public.fn_ca_declare_guard_redefinition('fn_ca_autoledger', 'migration 20261108155826_welcome_jackpot_returns_name_their_source_bank');

COMMIT;
