-- Minimal schema for the owner routing wallet proof.
-- public.agents is the PRODUCTION table: every column, default, CHECK, key and
-- foreign key read from pg_catalog on 2026-11-09 (184 rows there). The other
-- tables carry only the columns the installed functions in
-- live-definitions.json read or write. Every stand-in is marked STUB below;
-- nothing else in this file replaces an installed body.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA smarter_private; CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
-- STUB: Supabase's auth helpers, reading the same request settings.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.role',true),'')$$;

CREATE TABLE public.profiles(id uuid PRIMARY KEY,username text,display_name text,alias text,avatar_url text,status text DEFAULT 'active',is_horse boolean DEFAULT false);
CREATE TABLE public.unions(id uuid PRIMARY KEY,owner_id uuid,settings jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text,owner_id uuid,union_id uuid,is_union boolean DEFAULT false,asset text DEFAULT 'chips',
 lifecycle_status text DEFAULT 'active',chip_treasury numeric DEFAULT 0,chip_pool numeric DEFAULT 0,promo_balance numeric DEFAULT 0,updated_at timestamptz DEFAULT now(),
 logo_url text,avatar_url text,tagline text);
CREATE TABLE public.union_clubs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,union_id uuid,club_commission_rate numeric);
CREATE TABLE public.club_members(club_id uuid,user_id uuid,role text DEFAULT 'player',status text DEFAULT 'active',is_active boolean DEFAULT true,
 agent_id uuid,parent_agent_id uuid,chip_balance numeric DEFAULT 0,held_chips numeric DEFAULT 0,locked_chips numeric DEFAULT 0,
 player_rakeback_pct numeric DEFAULT 0,player_rakeback_explicit boolean DEFAULT false,rakeback_rate numeric DEFAULT 0,commission_rate numeric DEFAULT 0,
 membership_lifecycle_status text DEFAULT 'active',updated_at timestamptz DEFAULT now(),PRIMARY KEY(club_id,user_id));

CREATE TABLE public.agents(
 id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, club_id uuid NOT NULL, membership_id uuid, role text NOT NULL,
 status text NOT NULL DEFAULT 'active'::text, parent_agent_id uuid, commission_rate numeric(5,4) NOT NULL, player_rakeback_rate numeric(5,4) NOT NULL,
 credit_limit numeric(15,2) NOT NULL DEFAULT 0, credit_used numeric(15,2) NOT NULL DEFAULT 0, is_prepaid boolean NOT NULL DEFAULT true,
 business_balance numeric(15,2) NOT NULL DEFAULT 0, player_balance numeric(15,2) NOT NULL DEFAULT 0, promo_balance numeric(15,2) NOT NULL DEFAULT 0,
 total_players integer NOT NULL DEFAULT 0, active_player_count integer NOT NULL DEFAULT 0, sub_agent_count integer NOT NULL DEFAULT 0,
 weekly_rake_generated numeric(15,2) NOT NULL DEFAULT 0, lifetime_earnings numeric(15,2) NOT NULL DEFAULT 0,
 joined_at timestamptz NOT NULL DEFAULT now(), last_active_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 auto_rakeback_enabled boolean DEFAULT true, rakeback_percentage numeric(5,4) DEFAULT 0.0000, agent_wallet_balance numeric(18,2) DEFAULT 0,
 player_wallet_balance numeric(18,4) DEFAULT 0, promo_wallet_balance numeric(18,2) DEFAULT 0, lifetime_rake_generated numeric(18,4) DEFAULT 0,
 credit_control_revision bigint NOT NULL DEFAULT 0,
 CONSTRAINT agents_pkey PRIMARY KEY (id),
 CONSTRAINT agents_club_id_user_id_key UNIQUE (club_id, user_id),
 CONSTRAINT agents_agent_wallet_balance_nonneg CHECK ((agent_wallet_balance >= (0)::numeric)),
 CONSTRAINT agents_commission_rate_check CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= 0.70))),
 CONSTRAINT agents_credit_control_revision_nonnegative CHECK ((credit_control_revision >= 0)),
 CONSTRAINT agents_credit_used_check CHECK ((credit_used >= (0)::numeric)),
 CONSTRAINT agents_player_rakeback_rate_check CHECK (((player_rakeback_rate >= (0)::numeric) AND (player_rakeback_rate <= 0.50))),
 CONSTRAINT agents_promo_wallet_balance_nonneg CHECK ((promo_wallet_balance >= (0)::numeric)),
 CONSTRAINT agents_role_check CHECK ((role = ANY (ARRAY['super_agent'::text, 'agent'::text, 'sub_agent'::text]))),
 CONSTRAINT agents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'frozen'::text]))),
 CONSTRAINT check_credit CHECK (((credit_used <= credit_limit) OR (is_prepaid = true))),
 CONSTRAINT chk_player_wallet_balance_is_two_decimal_places CHECK (((player_wallet_balance IS NULL) OR (player_wallet_balance = round(player_wallet_balance, 2)))),
 CONSTRAINT agents_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE,
 CONSTRAINT fk_agents_user_id_profiles FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
 CONSTRAINT fk_agents_parent FOREIGN KEY (parent_agent_id) REFERENCES public.agents(id));
CREATE UNIQUE INDEX agents_agreement_club_and_id ON public.agents USING btree (club_id, id);
ALTER TABLE public.agents ADD CONSTRAINT agents_parent_in_same_club FOREIGN KEY (club_id, parent_agent_id) REFERENCES public.agents(club_id, id);
CREATE INDEX idx_agents_club ON public.agents USING btree (club_id);
CREATE INDEX idx_agents_user ON public.agents USING btree (user_id);
CREATE INDEX idx_agents_parent ON public.agents USING btree (parent_agent_id);

-- Production columns and defaults (observed_at is clock time, not transaction time).
CREATE TABLE public.accounting_agreement_history(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,entity_type text NOT NULL,entity_key text NOT NULL,
 club_id uuid,subject_user_id uuid,event_type text NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 transaction_id bigint NOT NULL DEFAULT txid_current(),actor_id uuid,before_terms jsonb,after_terms jsonb,union_id uuid);
CREATE INDEX accounting_agreement_history_entity_time ON public.accounting_agreement_history(entity_type,entity_key,observed_at,id);

-- The journal, as scripts/ci/fixtures/split-late-return/schema.sql builds it for
-- the same installed ledger functions, with the production category and
-- account lists cut to the values these cases use.
CREATE TABLE public.chip_ledger(id uuid DEFAULT gen_random_uuid(),performed_by uuid,from_type text,from_entity_id uuid,from_label text,to_type text,to_entity_id uuid,to_label text,
 amount numeric,category text,club_id uuid,union_id uuid,tournament_id uuid,description text,metadata jsonb DEFAULT '{}',
 pre_from_balance numeric,post_from_balance numeric,pre_to_balance numeric,post_to_balance numeric,created_at timestamptz,epoch_id uuid,actor_service text,db_role text,
 correlation_id uuid,settlement_id text,idempotency_key text,hand_id uuid,table_id uuid,chain_seq bigint,prev_hash text,row_hash text,status text DEFAULT 'posted',
 CONSTRAINT chip_ledger_category_check CHECK(category IN('rakeback','commission','club_bank_send','club_bank_claim','agent_funding','transfer','adjustment','credit_repayment')),
 CONSTRAINT chip_ledger_from_type_check CHECK(from_type IN('player_wallet','club_treasury','agent_wallet','promo_wallet','settlement_suspense','credit_facility')),
 CONSTRAINT chip_ledger_to_type_check CHECK(to_type IN('player_wallet','club_treasury','agent_wallet','promo_wallet','settlement_suspense','credit_facility')));
CREATE SEQUENCE public.chip_ledger_chain_seq;
CREATE TABLE public.chip_transactions(id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,club_id uuid NOT NULL,from_user_id uuid,to_user_id uuid,amount numeric(14,2) NOT NULL,
 transaction_type text NOT NULL,notes text,related_cashout_id uuid,metadata jsonb DEFAULT '{}'::jsonb,created_at timestamptz DEFAULT now(),balance_after numeric(14,2),
 clawed_back boolean DEFAULT false,reversible_until timestamptz,is_reversed boolean DEFAULT false,table_id uuid);
CREATE TABLE public.financial_alerts(severity text,source text,message text,context jsonb);
-- Production mode on 2026-11-09: 'refuse' globally and for every store.
CREATE TABLE public.ca_ledger_invariant_mode(mode text);
CREATE TABLE public.ca_ledger_invariant_store_mode(store text,mode text);
INSERT INTO public.ca_ledger_invariant_mode VALUES('refuse');
INSERT INTO public.ca_ledger_invariant_store_mode VALUES('player_wallet','refuse'),('club_treasury','refuse'),('agent_wallet','refuse'),('promo_wallet','refuse'),('settlement_suspense','refuse');

-- What the three agent readers the migration replaces read besides agents
-- (fn_ca_agent_payables, get_club_agents, fn_club_opening_checklist_complete):
-- only the columns they name.
CREATE TABLE public.agent_commission_unsettled_rollup(club_id uuid,user_id uuid,owed numeric,rows_behind bigint,oldest_unsettled timestamptz,updated_at timestamptz,PRIMARY KEY(club_id,user_id));
CREATE TABLE public.club_opening_checklists(club_id uuid PRIMARY KEY,completed_at timestamptz,completed_by uuid,skipped_task_ids text[] NOT NULL DEFAULT '{}',updated_at timestamptz DEFAULT now());
CREATE TABLE public.club_opening_setups(club_id uuid PRIMARY KEY);
CREATE TABLE public.tables(id uuid DEFAULT gen_random_uuid(),club_id uuid,game_variant text,status text);
CREATE TABLE public.tournaments(id uuid DEFAULT gen_random_uuid(),club_id uuid,format_contract text);

-- STUBS (not the installed bodies; each is outside what this proof judges).
CREATE FUNCTION public.fn_ca_can_manage_agents(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_club_opening_checklist_eligible(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_ca_ledger_refusal_record(jsonb) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.fn_ca_current_epoch() RETURNS uuid LANGUAGE sql AS $$SELECT md5('epoch')::uuid$$;
CREATE FUNCTION public.fn_cashier_exact_intent_begin(text,uuid,uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('state','proceed')$$;
CREATE FUNCTION public.fn_cashier_exact_intent_finish(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT $2$$;
CREATE FUNCTION public.fn_club_cashier_can_transact(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_is_union_overseer(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_union_week_start(timestamptz) RETURNS timestamptz LANGUAGE sql AS $$SELECT date_trunc('week',$1)$$;
CREATE FUNCTION public.fn_agent_weekly_statement(uuid,timestamptz,timestamptz,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;

CREATE FUNCTION public.orw_u(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT md5('orw:'||$1)::uuid$$;
CREATE FUNCTION public.orw_assert(b boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'orw_assert_failed: %',msg;END IF;END$$;
