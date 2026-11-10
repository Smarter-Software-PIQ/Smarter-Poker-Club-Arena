-- Narrow fixture for the production reconciliation views that reference both
-- copies of diamond journal amounts. Original view definitions read from the
-- PokerIQ catalog on 2026-11-10; fixture-only supporting objects stay here.
\set ON_ERROR_STOP on
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN RAISE EXCEPTION 'Private fixture required'; END IF; END $$;
-- Production has this archive PK, which the minimal fixture omits.
ALTER TABLE public.ca_diamond_journal_archive ADD PRIMARY KEY(id);
CREATE TABLE public.trivia_ledger_journals(id uuid PRIMARY KEY,idempotency_key text,operation text);
CREATE TABLE public.trivia_ledger_lines(journal_id uuid,line_no integer,user_id uuid,wallet_reference text,wallet_kind text,amount bigint,diamond_transaction_id uuid,created_at timestamptz,reconciliation_state text,account_kind text);
CREATE TABLE public.trivia_ledger_accounts(user_id uuid,kind text,balance bigint);
CREATE FUNCTION public.trivia_ledger_epoch() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT '2026-01-01 UTC'::timestamptz$$;
CREATE FUNCTION public.trivia_ledger_switch_at(text,timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
INSERT INTO public.trivia_ledger_journals VALUES ('4b089c1c-4631-4959-837b-62baec369d2b','fixture','wallet');
INSERT INTO public.trivia_ledger_lines SELECT '4b089c1c-4631-4959-837b-62baec369d2b',1,user_id,reference_id,coalesce(transaction_type,type),amount,id,created_at,'linked','player_wallet' FROM public.diamond_transactions ORDER BY id LIMIT 1;
CREATE VIEW public.trivia_ledger_recon_date WITH (security_invoker=true) AS
 SELECT ((l.created_at AT TIME ZONE 'America/Chicago'::text))::date AS chicago_date,
    count(DISTINCT l.journal_id) AS journals,
    count(*) AS lines,
    sum(l.amount) AS imbalance,
    COALESCE(sum((- l.amount)) FILTER (WHERE ((l.account_kind = 'player_wallet'::text) AND (l.amount < 0))), (0)::numeric) AS wallet_debits,
    COALESCE(sum(l.amount) FILTER (WHERE ((l.account_kind = 'player_wallet'::text) AND (l.amount > 0))), (0)::numeric) AS wallet_credits,
    COALESCE(sum(l.amount) FILTER (WHERE (l.account_kind = 'player_wallet'::text)), (0)::numeric) AS wallet_net,
    COALESCE(sum(COALESCE(d.amount, ar.amount)) FILTER (WHERE (l.account_kind = 'player_wallet'::text)), (0)::bigint) AS platform_net,
    (COALESCE(sum(l.amount) FILTER (WHERE (l.account_kind = 'player_wallet'::text)), (0)::numeric) - (COALESCE(sum(COALESCE(d.amount, ar.amount)) FILTER (WHERE (l.account_kind = 'player_wallet'::text)), (0)::bigint))::numeric) AS unexplained_variance
   FROM ((trivia_ledger_lines l
     LEFT JOIN diamond_transactions d ON ((d.id = l.diamond_transaction_id)))
     LEFT JOIN ca_diamond_journal_archive ar ON ((ar.id = l.diamond_transaction_id)))
  GROUP BY (((l.created_at AT TIME ZONE 'America/Chicago'::text))::date);
REVOKE ALL ON public.trivia_ledger_recon_date FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.trivia_ledger_recon_date TO service_role;
CREATE VIEW public.trivia_ledger_recon_reference WITH (security_invoker=true) AS
 SELECT 'journal'::text AS origin,
    j.id AS journal_id,
    j.idempotency_key,
    j.operation,
    l.line_no,
    l.user_id,
    l.wallet_reference AS reference,
    l.wallet_kind AS kind,
    l.amount,
    l.diamond_transaction_id,
    (COALESCE(d.amount, ar.amount))::bigint AS platform_amount,
    COALESCE(d.created_at, ar.created_at, l.created_at) AS created_at,
        CASE
            WHEN ((d.id IS NULL) AND (ar.id IS NULL)) THEN 'missing_platform_row'::text
            WHEN (COALESCE(d.user_id, ar.user_id) IS DISTINCT FROM l.user_id) THEN 'user_mismatch'::text
            WHEN ((COALESCE(d.amount, ar.amount))::bigint IS DISTINCT FROM l.amount) THEN 'amount_mismatch'::text
            WHEN (COALESCE(NULLIF(btrim(COALESCE(d.transaction_type, ar.transaction_type)), ''::text), d.type, ar.type) IS DISTINCT FROM l.wallet_kind) THEN 'kind_mismatch'::text
            WHEN ((l.reconciliation_state = 'linked'::text) AND (COALESCE(d.reference_id, ar.reference_id) IS DISTINCT FROM l.wallet_reference)) THEN 'reference_mismatch'::text
            WHEN (d.id IS NULL) THEN 'reconciled_archived'::text
            ELSE 'reconciled'::text
        END AS state
   FROM (((trivia_ledger_lines l
     JOIN trivia_ledger_journals j ON ((j.id = l.journal_id)))
     LEFT JOIN diamond_transactions d ON ((d.id = l.diamond_transaction_id)))
     LEFT JOIN ca_diamond_journal_archive ar ON ((ar.id = l.diamond_transaction_id)))
  WHERE (l.account_kind = 'player_wallet'::text)
UNION ALL
 SELECT 'platform'::text AS origin,
    NULL::uuid AS journal_id,
    NULL::text AS idempotency_key,
    NULL::text AS operation,
    NULL::integer AS line_no,
    d.user_id,
    d.reference_id AS reference,
    COALESCE(NULLIF(btrim(d.transaction_type), ''::text), d.type) AS kind,
    (d.amount)::bigint AS amount,
    d.id AS diamond_transaction_id,
    (d.amount)::bigint AS platform_amount,
    d.created_at,
        CASE
            WHEN (d.created_at < trivia_ledger_epoch()) THEN 'legacy_pending_backfill'::text
            WHEN ((trivia_ledger_platform_family(COALESCE(NULLIF(btrim(d.transaction_type), ''::text), d.type), d.reference_id) = 'solo'::text) AND (NOT trivia_ledger_switch_at('solo_journal'::text, d.created_at))) THEN 'legacy_path_switch_off'::text
            ELSE 'unjournaled_unexplained'::text
        END AS state
   FROM diamond_transactions d
  WHERE ((trivia_ledger_platform_family(COALESCE(NULLIF(btrim(d.transaction_type), ''::text), d.type), d.reference_id) IS NOT NULL) AND (d.amount <> 0) AND (NOT (EXISTS ( SELECT 1
           FROM trivia_ledger_lines l
          WHERE (l.diamond_transaction_id = d.id)))));
REVOKE ALL ON public.trivia_ledger_recon_reference FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.trivia_ledger_recon_reference TO service_role;
CREATE VIEW public.trivia_ledger_recon_user WITH (security_invoker=true) AS
 SELECT l.user_id,
    count(*) AS wallet_lines,
    sum(l.amount) AS journal_net,
    sum(COALESCE(d.amount, ar.amount, 0)) AS platform_net,
    (sum(l.amount) - (sum(COALESCE(d.amount, ar.amount, 0)))::numeric) AS unexplained_variance,
    count(*) FILTER (WHERE ((d.id IS NULL) AND (ar.id IS NULL))) AS missing_platform_rows,
    COALESCE(( SELECT sum(la.balance) AS sum
           FROM trivia_ledger_accounts la
          WHERE ((la.kind = 'refund_liability'::text) AND (la.user_id = l.user_id))), (0)::numeric) AS owed_liability
   FROM ((trivia_ledger_lines l
     LEFT JOIN diamond_transactions d ON ((d.id = l.diamond_transaction_id)))
     LEFT JOIN ca_diamond_journal_archive ar ON ((ar.id = l.diamond_transaction_id)))
  WHERE (l.account_kind = 'player_wallet'::text)
  GROUP BY l.user_id;
REVOKE ALL ON public.trivia_ledger_recon_user FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.trivia_ledger_recon_user TO service_role;
CREATE VIEW public.test_trivia_recon_downstream AS SELECT chicago_date,platform_net FROM public.trivia_ledger_recon_date;
COMMENT ON VIEW public.trivia_ledger_recon_user IS 'fixture view comment';
COMMENT ON COLUMN public.trivia_ledger_recon_user.platform_net IS 'fixture column comment';
GRANT SELECT (platform_net) ON public.trivia_ledger_recon_date TO authenticated;
CREATE TABLE public.test_diamond_recon_before AS SELECT c.oid,c.relname,c.relowner,c.relacl,c.reloptions,
 obj_description(c.oid,'pg_class') AS comment,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attacl,col_description(c.oid,a.attnum)) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('trivia_ledger_recon_date','trivia_ledger_recon_user','trivia_ledger_recon_reference','test_trivia_recon_downstream');
CREATE TABLE public.test_diamond_recon_rows AS
 SELECT 'date'::text name,to_jsonb(d) entry FROM public.trivia_ledger_recon_date d UNION ALL
 SELECT 'user',to_jsonb(u) FROM public.trivia_ledger_recon_user u UNION ALL
 SELECT 'reference',to_jsonb(r) FROM public.trivia_ledger_recon_reference r;

CREATE TABLE public.test_diamond_storage_before AS
 SELECT oid,pg_relation_filenode(oid) AS filenode FROM pg_class
 WHERE oid IN ('public.diamond_transactions'::regclass,'public.ca_diamond_balance_audit'::regclass)
 OR oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN
 ('public.diamond_transactions'::regclass,'public.ca_diamond_balance_audit'::regclass)
 AND indexrelid <> 'public.diamond_transactions_trivia_family_created_idx'::regclass);
