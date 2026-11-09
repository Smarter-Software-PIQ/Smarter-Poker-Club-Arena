-- CORRECTION to 20261109132254: it cleared app.ledger_autoskip_club_members
-- too late. The split late return's single chip_ledger leg (player_wallet ->
-- club_treasury, the standalone shape of all 636 historical returns) is
-- written by the autoledger ON THE MEMBER DEBIT UPDATE, with the declared
-- counterparty carrying the treasury side; the clubs update is deliberately
-- autoskipped. 20261109132254 placed the member clear after both updates, so
-- inside the rakeback stage (which stands the member autoledger down for its
-- own declared legs) the debit still ran suppressed and the 14:04Z attempt
-- refused with the identical 601.94 treasury gap. This migration clears
-- app.ledger_autoskip_club_members immediately BEFORE the member debit,
-- inside the trigger's protected block; the trigger's existing save/restore
-- of that key at entry/exit is unchanged, so the caller's flag environment
-- is restored exactly, including across multiple returns in one
-- transaction. The replaced text below is a replace() needle fragment of
-- the trigger's own body, WHERE clause included; no executed statement in
-- this migration writes club_members. Standalone behavior unchanged (the
-- key is already empty there). Dan's 2026-11-03 return-to-bank ruling
-- preserved exactly.
-- @live-proof: position('app.ledger_autoskip_club_members' in substring(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure) from 1 for position('UPDATE public.club_members' in pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure)))) > 0
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 src text;
 needle text := $o$    UPDATE public.club_members SET chip_balance = coalesce(chip_balance, 0) - v_amount, updated_at = now()
     WHERE club_id = NEW.club_id AND user_id = NEW.user_id RETURNING chip_balance INTO v_after;$o$;
 repl text := $n$    PERFORM set_config('app.ledger_autoskip_club_members', '', true);
    UPDATE public.club_members SET chip_balance = coalesce(chip_balance, 0) - v_amount, updated_at = now()
     WHERE club_id = NEW.club_id AND user_id = NEW.user_id RETURNING chip_balance INTO v_after;$n$;
BEGIN
 src := pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure);
 IF md5(src) IS DISTINCT FROM 'e1bd766347c196e52e891da762e76403' THEN
  RAISE EXCEPTION 'split_return_trigger_preimage_changed md5=%', md5(src);
 END IF;
 IF (length(src)-length(replace(src,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one member debit update';
 END IF;
 src := replace(src, needle, repl);
 EXECUTE src;
 src := pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure);
 IF position('app.ledger_autoskip_club_members' in substring(src from 1 for position('UPDATE public.club_members' in src))) = 0 THEN
  RAISE EXCEPTION 'postimage missing pre-debit member clear';
 END IF;
END $patch$;
COMMIT;
