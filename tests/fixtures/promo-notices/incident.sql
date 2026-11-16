CREATE OR REPLACE FUNCTION public.fn_ca_reconcile_log_to_incident()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_class text; v_layer text; v_club uuid; v_kind text; v_illegal boolean;
BEGIN
  IF NEW.severity NOT IN ('warn','critical') THEN RETURN NEW; END IF;

  v_kind := NEW.metadata->>'kind';
  -- An over-rake takes chips off a player that the rules never owed the
  -- house. board_not_recorded and impossible_showdown really are evidence
  -- gaps; these three are money.
  v_illegal := NEW.entity_type = 'rake_law'
               AND v_kind IN ('no_flop_no_drop','over_cap','over_percent');

  v_class := CASE
    WHEN v_illegal THEN 'incorrect_rake'
    ELSE CASE NEW.entity_type
      WHEN 'club_treasury' THEN 'treasury_error'
      WHEN 'frozen_wallets_pool' THEN 'unauthorized_adjustment'
      WHEN 'seat_stack_exit' THEN 'missing_payment'
      WHEN 'negative_balance' THEN 'ledger_imbalance'
      WHEN 'insurance_bank' THEN 'settlement_error'
      WHEN 'insurance_offer_unresolved' THEN 'settlement_error'
      WHEN 'cashout_escrow_stuck' THEN 'settlement_error'
      WHEN 'over_claimed_send' THEN 'duplicate_payment'
      WHEN 'bomb_award_ledger_gap' THEN 'reporting_mismatch'
      WHEN 'rake_law' THEN 'reporting_mismatch'
      ELSE 'unknown' END
  END;

  v_layer := CASE
    WHEN v_illegal THEN 'settlement'
    WHEN NEW.entity_type IN ('bomb_award_ledger_gap','rake_law') THEN 'reporting'
    ELSE 'ledger' END;

  BEGIN v_club := NULLIF(NEW.metadata->>'club_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN v_club := NULL; END;
  IF v_club IS NULL AND NEW.entity_type = 'club_treasury' THEN v_club := NEW.entity_id; END IF;

  PERFORM public.fn_ca_raise_drift_incident(
    p_source => 'ledger_reconcile_log:' || COALESCE(NEW.metadata->>'source', v_kind, '?'),
    p_classification => v_class,
    p_severity => CASE WHEN v_illegal THEN 'critical'
                       WHEN NEW.severity = 'critical' THEN 'critical'
                       ELSE 'warning' END,
    p_dedupe_key => 'lrl:' || NEW.entity_type || ':' || COALESCE(NEW.entity_id::text,'-') || ':' ||
      COALESCE(NEW.metadata->>'exit_id', NEW.metadata->>'hand_history_id',
               NEW.metadata->>'hand_id', NEW.metadata->>'escrow_id', ''),
    p_discrepancy => COALESCE(NEW.stored_balance,0) - COALESCE(NEW.ledger_balance,0),
    p_expected => NEW.ledger_balance,
    p_actual => NEW.stored_balance,
    p_layer => v_layer,
    p_entity_type => NEW.entity_type,
    p_entity_id => NEW.entity_id,
    p_club_id => v_club,
    p_suspected_cause => COALESCE(NEW.metadata->>'rule', v_kind),
    p_metadata => COALESCE(NEW.metadata,'{}'::jsonb));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_ca_reconcile_log_to_incident failed: %', SQLERRM;
  RETURN NEW;
END $function$

;
