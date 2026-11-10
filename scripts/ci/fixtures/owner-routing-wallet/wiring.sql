-- Triggers on public.agents exactly as pg_get_triggerdef printed them on
-- production 2026-11-09 (27 triggers there). Wired here: every trigger whose
-- function can decide whether a wallet_only row may exist, change or move
-- chips. NOT wired, because none reads agents.status or a rate: the two replica guards, the two realtime
-- publishers, the staff notice, the retired-club guard, the automated-user
-- guard, the Deep Stack delete guard, the delete autoledger and the
-- deleted-account credit sweep.
CREATE TRIGGER accounting_agreement_history AFTER INSERT OR DELETE OR UPDATE OF id, club_id, user_id, parent_agent_id, role, status, commission_rate, player_rakeback_rate, is_prepaid ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_accounting_agreement_capture();
CREATE TRIGGER cashier_agent_balance_actor_guard BEFORE UPDATE OF agent_wallet_balance, promo_wallet_balance, credit_used ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_cashier_balance_actor_guard();
CREATE TRIGGER cashier_agent_operation_mutex BEFORE UPDATE ON public.agents FOR EACH STATEMENT EXECUTE FUNCTION fn_cashier_operation_mutex_guard();
CREATE TRIGGER cashier_agent_status_mutex_delete BEFORE DELETE ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_cashier_agent_status_mutex();
CREATE TRIGGER cashier_agent_status_mutex_update BEFORE UPDATE OF status, club_id, user_id ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_cashier_agent_status_mutex();
CREATE TRIGGER guard_agent_wallet_direct_update BEFORE INSERT OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION guard_agent_wallet_direct_update();
CREATE TRIGGER poker_arena_no_hierarchy BEFORE INSERT OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_poker_reject_diamond_hierarchy();
CREATE TRIGGER trg_agent_default_prepaid BEFORE INSERT OR UPDATE OF is_prepaid, credit_limit ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_agent_default_prepaid();
CREATE TRIGGER trg_agents_commission_bounds BEFORE INSERT OR UPDATE OF commission_rate ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_enforce_agent_commission_bounds();
CREATE TRIGGER trg_agents_staff_earn_no_rakeback BEFORE INSERT OR UPDATE OF role, commission_rate, player_rakeback_rate ON public.agents FOR EACH ROW WHEN (((COALESCE(new.commission_rate, (0)::numeric) <> (0)::numeric) OR (COALESCE(new.player_rakeback_rate, (0)::numeric) <> (0)::numeric))) EXECUTE FUNCTION fn_agents_staff_earn_no_rakeback();
CREATE TRIGGER trg_ca_autoledger AFTER UPDATE OF agent_wallet_balance, promo_wallet_balance ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_ca_autoledger('agent_wallet_balance=agent_wallet', 'promo_wallet_balance=promo_wallet');
CREATE TRIGGER trg_ca_autoledger_insert AFTER INSERT ON public.agents FOR EACH ROW WHEN (((COALESCE(new.agent_wallet_balance, (0)::numeric) <> (0)::numeric) OR (COALESCE(new.promo_wallet_balance, (0)::numeric) <> (0)::numeric))) EXECUTE FUNCTION fn_ca_autoledger('agent_wallet_balance=agent_wallet', 'promo_wallet_balance=promo_wallet');
CREATE TRIGGER trg_sync_agent_wallets BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION sync_agent_wallet_columns();
CREATE TRIGGER zy_ca_tally_store_move AFTER INSERT OR DELETE OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_store_move();
CREATE CONSTRAINT TRIGGER zz_ca_store_has_its_ledger_row AFTER INSERT OR DELETE OR UPDATE ON public.agents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE TRIGGER zz_guard_agent_agreement BEFORE INSERT OR UPDATE OF id, user_id, club_id, parent_agent_id, role, commission_rate, player_rakeback_rate, credit_limit ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_guard_agent_agreement();
CREATE TRIGGER zzzz_credit_control_revision_v1 BEFORE INSERT OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION fn_agent_credit_control_revision_v1();
-- Agreement history for the two other observed entities.
CREATE TRIGGER accounting_agreement_history AFTER INSERT OR DELETE OR UPDATE ON public.club_members FOR EACH ROW EXECUTE FUNCTION fn_accounting_agreement_capture();
CREATE TRIGGER accounting_agreement_history AFTER INSERT OR DELETE OR UPDATE ON public.union_clubs FOR EACH ROW EXECUTE FUNCTION fn_accounting_agreement_capture();
-- The journal and its deferred balance guard on the bank, the player wallet
-- and the ledger, as scripts/ci/fixtures/split-late-return/wiring.sql wires
-- the same installed functions; production's ledger-side constraint trigger
-- is named zz_ca_ledger_row_has_its_balance.
CREATE TRIGGER trg_club_members_audit_chip_movement AFTER UPDATE ON public.club_members FOR EACH ROW EXECUTE FUNCTION fn_club_members_ledger_writer();
CREATE TRIGGER trg_ca_autoledger AFTER UPDATE ON public.clubs FOR EACH ROW EXECUTE FUNCTION fn_ca_autoledger('chip_treasury=club_treasury','chip_pool=club_treasury');
CREATE TRIGGER zy_ca_tally_balance_move AFTER UPDATE ON public.club_members FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE TRIGGER zy_ca_tally_balance_move AFTER UPDATE ON public.clubs FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE TRIGGER trg_ca_chip_ledger_enrich BEFORE INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_chip_ledger_enrich();
CREATE TRIGGER zy_ca_tally_ledger_leg AFTER INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_ledger_leg();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER UPDATE ON public.clubs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER UPDATE ON public.club_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE CONSTRAINT TRIGGER zz_ca_ledger_row_has_its_balance AFTER INSERT ON public.chip_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
