-- Fixture-only collaborators. None of these is a candidate or a money owner:
-- each stands in for an identity, gate or bookkeeping helper that the
-- rotation does not change, so the candidate money paths run end to end.
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$SELECT 'unlimited-mtt-v2'::text$$;
CREATE FUNCTION public.fn_ca_tournament_is_unlimited(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.fn_tournament_entry_cap_reached(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.is_club_admin(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.fn_ensure_club_wallet(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.fn_ca_assert_tournament_chip_grant(uuid,uuid,uuid,numeric,text) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.fn_ca_record_tournament_participant_funding(uuid,text,text,numeric,text,uuid,uuid,jsonb)
 RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION smarter_private.tournament_abort_ingress(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.fn_can_manage_tournament_schedule(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;

-- The roster trigger keeps the cached count for a pre-start event.
CREATE FUNCTION fixture_roster_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE public.tournaments t SET current_players=(SELECT count(*) FROM public.tournament_players p
   WHERE p.tournament_id=t.id AND p.status IN ('registered','playing'))
  WHERE t.id=coalesce(NEW.tournament_id,OLD.tournament_id) AND t.status IN ('ANNOUNCED','REGISTERING');
 RETURN NULL;
END $$;
CREATE TRIGGER fixture_roster_count AFTER INSERT OR DELETE ON public.tournament_players
 FOR EACH ROW EXECUTE FUNCTION fixture_roster_count();
-- A registration's funding club, as the production roster stamp sets it.
CREATE FUNCTION fixture_roster_club() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.club_id:=coalesce(NEW.club_id,'fade0000-0000-0000-0000-000000000001'::uuid); RETURN NEW; END $$;
CREATE TRIGGER fixture_roster_club BEFORE INSERT ON public.tournament_players
 FOR EACH ROW EXECUTE FUNCTION fixture_roster_club();

-- The club wallet journal: one declared leg per chip_balance write, as
-- trg_club_members_audit_chip_movement writes it from the app.ledger_* declaration.
CREATE FUNCTION fixture_club_member_leg() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric:=round(OLD.chip_balance-NEW.chip_balance,2);
BEGIN
 IF d=0 THEN RETURN NULL; END IF;
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,
   club_id,tournament_id,idempotency_key,metadata)
 VALUES(NEW.user_id,'player_wallet',NEW.user_id,
   current_setting('app.ledger_counterparty',true),
   NULLIF(current_setting('app.ledger_counterparty_entity',true),'')::uuid,
   d,current_setting('app.ledger_category',true),NEW.club_id,
   NULLIF(current_setting('app.ledger_tournament',true),'')::uuid,
   'fixture-wallet-leg:'||gen_random_uuid(),'{}'::jsonb);
 RETURN NULL;
END $$;
CREATE TRIGGER fixture_club_member_leg AFTER UPDATE OF chip_balance ON public.club_members
 FOR EACH ROW EXECUTE FUNCTION fixture_club_member_leg();
