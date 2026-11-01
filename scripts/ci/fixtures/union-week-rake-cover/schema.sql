-- Exact production sources (read 2026-10-31): tables (relevant columns/keys/indexes), the launch cutoff owner and the three source views.
CREATE TABLE public.accounting_cash_rake_sources(id uuid PRIMARY KEY,rake_record_id uuid,player_id uuid,club_id uuid,union_id uuid,coordinator_union_id uuid,earned_at timestamptz,rake_credit numeric,contract jsonb,recorded_at timestamptz,UNIQUE(rake_record_id,player_id));
CREATE INDEX accounting_cash_rake_sources_bank_period ON public.accounting_cash_rake_sources USING btree (union_id, earned_at) WHERE (union_id IS NOT NULL);
CREATE INDEX accounting_cash_rake_sources_coordinator_period ON public.accounting_cash_rake_sources USING btree (coordinator_union_id, earned_at, club_id);
CREATE INDEX accounting_cash_foreign_certificate_club_week_cover ON public.accounting_cash_rake_sources USING btree (club_id, earned_at) INCLUDE (id, player_id, rake_record_id, coordinator_union_id, rake_credit);
CREATE INDEX accounting_cash_rake_sources_period ON public.accounting_cash_rake_sources USING btree (club_id, earned_at, player_id);
CREATE TABLE public.accounting_cash_funding_contract_admissions(source_id uuid PRIMARY KEY,original_contract jsonb,admitted_contract jsonb,original_club_id uuid,funding_club_id uuid,original_chair jsonb,buyin_ledger jsonb,wallet_debit jsonb,admitted_at timestamptz);
CREATE TABLE public.accounting_cash_atomic_contract_admissions(source_id uuid PRIMARY KEY,original_contract jsonb,admitted_contract jsonb,original_commissions jsonb,invalid_history_ids bigint[],admitted_at timestamptz);
CREATE TABLE public.accounting_own_agent_interpretations(source_type text,source_id uuid,version text,club_id uuid,player_id uuid,earned_at timestamptz,raw_source jsonb,raw_source_md5 text,original_contract jsonb,admitted_contract jsonb,original_commissions jsonb,admitted_at timestamptz,PRIMARY KEY(source_type,source_id));
CREATE TABLE public.accounting_tournament_fee_sources(id uuid PRIMARY KEY,rake_record_id uuid,tournament_id uuid,player_id uuid,club_id uuid,union_id uuid,coordinator_union_id uuid,game_type text,registration_id uuid,source_charge_ledger_id uuid,source_entitlement_id uuid UNIQUE,charged_at timestamptz,rake_credit numeric,contract jsonb,recorded_at timestamptz,UNIQUE(rake_record_id,player_id));
CREATE INDEX accounting_tournament_fee_sources_coordinator_event ON public.accounting_tournament_fee_sources USING btree (coordinator_union_id, tournament_id) WHERE (coordinator_union_id IS NOT NULL);
CREATE TABLE public.accounting_tournament_recognized_sources(source_id uuid PRIMARY KEY,tournament_id uuid,recognized_at timestamptz,disposition text,rake_credit numeric);
CREATE INDEX accounting_tournament_recognized_sources_week ON public.accounting_tournament_recognized_sources USING btree (recognized_at, tournament_id);
CREATE TABLE public.accounting_tournament_fee_recognitions(tournament_id uuid PRIMARY KEY,recognized_at timestamptz,status text,net_rake numeric,union_id uuid,bank_club_id uuid,union_wallet_transaction_id uuid UNIQUE,bank_journal_id uuid UNIQUE,source_fingerprint text,plan jsonb);
CREATE TABLE public.ca_launch_accounting_boundaries(scope_kind text,scope_id uuid,operation_id uuid,cutoff_at timestamptz,activated_at timestamptz,waiver_reason text,undone_at timestamptz,PRIMARY KEY(scope_kind,scope_id,operation_id));
CREATE UNIQUE INDEX ca_launch_accounting_one_active ON public.ca_launch_accounting_boundaries USING btree (scope_kind, scope_id) WHERE (undone_at IS NULL);
CREATE OR REPLACE FUNCTION public.fn_ca_launch_accounting_club_cutoffs()
 RETURNS TABLE(club_id uuid, cutoff_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER ROWS 10
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT b.scope_id, b.cutoff_at FROM public.ca_launch_accounting_boundaries b
  WHERE b.scope_kind='club' AND b.undone_at IS NULL
$function$
;
CREATE VIEW public.accounting_effective_cash_rake_sources AS
 SELECT s.id,
    s.rake_record_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.earned_at,
    s.rake_credit,
    COALESCE(a.admitted_contract, s.contract) AS contract,
    GREATEST(s.recorded_at, a.admitted_at) AS recorded_at
   FROM (( SELECT s_1.id,
            s_1.rake_record_id,
            s_1.player_id,
            s_1.club_id,
            s_1.union_id,
            s_1.coordinator_union_id,
            s_1.earned_at,
            s_1.rake_credit,
            COALESCE(a_1.admitted_contract, s_1.contract) AS contract,
            GREATEST(s_1.recorded_at, a_1.admitted_at) AS recorded_at
           FROM (accounting_cash_rake_sources s_1
             LEFT JOIN accounting_cash_atomic_contract_admissions a_1 ON ((a_1.source_id = s_1.id)))
          WHERE (NOT (EXISTS ( SELECT
                   FROM accounting_cash_funding_contract_admissions f
                  WHERE (f.source_id = s_1.id))))
        UNION ALL
         SELECT s_1.id,
            s_1.rake_record_id,
            s_1.player_id,
            f.funding_club_id AS club_id,
            s_1.union_id,
            s_1.coordinator_union_id,
            s_1.earned_at,
            s_1.rake_credit,
            f.admitted_contract AS contract,
            GREATEST(s_1.recorded_at, a_1.admitted_at, f.admitted_at) AS recorded_at
           FROM ((accounting_cash_funding_contract_admissions f
             JOIN accounting_cash_rake_sources s_1 ON ((s_1.id = f.source_id)))
             LEFT JOIN accounting_cash_atomic_contract_admissions a_1 ON ((a_1.source_id = s_1.id)))) s
     LEFT JOIN accounting_own_agent_interpretations a ON (((a.source_type = 'cash_rake_accrual'::text) AND (a.source_id = s.id))));
CREATE VIEW public.accounting_effective_tournament_fee_sources AS
 SELECT s.id,
    s.rake_record_id,
    s.tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.game_type,
    s.registration_id,
    s.source_charge_ledger_id,
    s.source_entitlement_id,
    s.charged_at,
    s.rake_credit,
    COALESCE(a.admitted_contract, s.contract) AS contract,
    GREATEST(s.recorded_at, a.admitted_at) AS recorded_at
   FROM (accounting_tournament_fee_sources s
     LEFT JOIN accounting_own_agent_interpretations a ON (((a.source_type = 'tournament_fee_accrual'::text) AND (a.source_id = s.id))));
CREATE VIEW public.accounting_payable_earning_sources AS
 SELECT 'cash_rake_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    NULL::uuid AS tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.earned_at,
    s.rake_credit,
    s.contract
   FROM (accounting_effective_cash_rake_sources s
     LEFT JOIN fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON ((bd.club_id = s.club_id)))
  WHERE ((bd.cutoff_at IS NULL) OR ((s.earned_at IS NOT NULL) AND isfinite(s.earned_at) AND (s.earned_at >= bd.cutoff_at)))
UNION ALL
 SELECT 'tournament_fee_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    s.tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    rs.recognized_at AS earned_at,
    s.rake_credit,
    s.contract
   FROM (((accounting_effective_tournament_fee_sources s
     JOIN accounting_tournament_recognized_sources rs ON (((rs.source_id = s.id) AND (rs.tournament_id = s.tournament_id))))
     JOIN accounting_tournament_fee_recognitions r ON ((r.tournament_id = s.tournament_id)))
     LEFT JOIN fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON ((bd.club_id = s.club_id)))
  WHERE (((bd.cutoff_at IS NULL) OR ((s.charged_at IS NOT NULL) AND isfinite(s.charged_at) AND (s.charged_at >= bd.cutoff_at))) AND ((bd.cutoff_at IS NULL) OR ((rs.recognized_at IS NOT NULL) AND isfinite(rs.recognized_at) AND (rs.recognized_at >= bd.cutoff_at))) AND (rs.disposition = 'earned'::text) AND (r.status = 'recognized'::text) AND (rs.rake_credit = s.rake_credit) AND (rs.recognized_at = r.recognized_at) AND (NOT (s.union_id IS DISTINCT FROM r.union_id)));
