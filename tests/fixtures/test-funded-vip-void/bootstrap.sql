-- Minimal schema for 20261102192818 void_a_vip_purchase_paid_with_admin_minted_test_funding.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_vip boolean DEFAULT false, vip_tier text, vip_expires_at timestamptz, diamonds integer DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.diamond_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL, amount integer NOT NULL, balance_after integer, description text, reference_id text, created_at timestamptz DEFAULT now(), transaction_type text, source text, metadata jsonb, counterparty text, issuance_class text);
CREATE TABLE public.vip_diamond_purchase_requests(reference_id text PRIMARY KEY, user_id uuid NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- F: the fixture. Admin mint 2,009, VIP Monthly for 2,000, unspent 9 burned.
INSERT INTO public.profiles VALUES ('f0000000-0000-4000-8000-000000000001', true, 'monthly', '2026-12-02T08:17:15.171744+00', 0, now());
INSERT INTO public.diamond_transactions(user_id,type,amount,balance_after,reference_id,created_at,transaction_type,source,counterparty,issuance_class) VALUES
 ('f0000000-0000-4000-8000-000000000001','earn',2009,2009,'mint-f','2026-11-02T08:16:03+00','mint','the_mint','issuance','admin'),
 ('f0000000-0000-4000-8000-000000000001','vip_membership',-2000,9,'vip-f','2026-11-02T08:17:15.171744+00','vip_membership',NULL,'revenue:vip_membership','spend'),
 ('f0000000-0000-4000-8000-000000000001','spend',-9,0,'burn-f','2026-11-02T09:27:48+00','burn','the_mint','retired','admin');
INSERT INTO public.vip_diamond_purchase_requests VALUES ('vip-f','f0000000-0000-4000-8000-000000000001','h','{"tier":"monthly","is_vip":true,"success":true,"expires_at":"2026-12-02T08:17:15.171744+00:00"}','2026-11-02T08:17:15.171744+00');
-- P: a real player who bought diamonds and then VIP. Never voidable here.
INSERT INTO public.profiles VALUES ('a0000000-0000-4000-8000-000000000002', true, 'monthly', now() + interval '20 days', 3000, now());
INSERT INTO public.diamond_transactions(user_id,type,amount,balance_after,reference_id,created_at,transaction_type,counterparty,issuance_class) VALUES
 ('a0000000-0000-4000-8000-000000000002','purchase',5000,5000,'stripe-p',now() - interval '11 days','purchase','stripe','purchase'),
 ('a0000000-0000-4000-8000-000000000002','vip_membership',-2000,3000,'vip-p',now() - interval '10 days','vip_membership','revenue:vip_membership','spend');
INSERT INTO public.vip_diamond_purchase_requests VALUES ('vip-p','a0000000-0000-4000-8000-000000000002','h',jsonb_build_object('tier','monthly','expires_at',now() + interval '20 days'),now() - interval '10 days');
UPDATE public.profiles SET vip_expires_at = (SELECT (response->>'expires_at')::timestamptz FROM public.vip_diamond_purchase_requests WHERE reference_id='vip-p') WHERE id='a0000000-0000-4000-8000-000000000002';
-- X: minted funding, but the VIP was extended after (a later purchase). Refused for review.
INSERT INTO public.profiles VALUES ('c0000000-0000-4000-8000-000000000003', true, 'monthly', now() + interval '50 days', 9, now());
INSERT INTO public.diamond_transactions(user_id,type,amount,balance_after,reference_id,created_at,transaction_type,counterparty,issuance_class) VALUES
 ('c0000000-0000-4000-8000-000000000003','earn',2009,2009,'mint-x',now() - interval '2 days','mint','issuance','admin'),
 ('c0000000-0000-4000-8000-000000000003','vip_membership',-2000,9,'vip-x',now() - interval '1 day','vip_membership','revenue:vip_membership','spend');
INSERT INTO public.vip_diamond_purchase_requests VALUES ('vip-x','c0000000-0000-4000-8000-000000000003','h',jsonb_build_object('tier','monthly','expires_at',now() + interval '20 days'),now() - interval '1 day');
