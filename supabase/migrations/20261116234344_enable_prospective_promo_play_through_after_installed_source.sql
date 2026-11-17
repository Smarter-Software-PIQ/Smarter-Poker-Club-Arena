-- HELD: do not merge or install until the root verifies all ten daily
-- migrations, the c67da40a engine behavior, exact World Hub terms writer and
-- Club Arena held terms reader LIVE. This source makes no claim about those
-- external release facts. Preparation is not programme activation.
-- Version reserved by scripts/new-migration.mjs against remote branches.
-- @live-proof: EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND multiplier=4 AND expiry_days=30 AND enforced_from IS NOT NULL)
-- Only the existing cold singleton changes. No wallet scan, grant backfill,
-- principal mutation, payment, W2 policy change, new RPC or scheduler.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $activate$
DECLARE dial public.ca_promo_play_through_settings%ROWTYPE;activation_at timestamptz;
BEGIN
 IF EXISTS(
  SELECT 1 FROM(VALUES
   ('20261116151020','signup_promo_is_granted_once_per_verified_phone_and_known_de'),
   ('20261116195541','club_arena_terms_acceptance_records_the_exact_reviewed_revis'),
   ('20261116153059','promo_principal_follows_its_original_grant_through_wallet_an'),
   ('20261116154719','promo_tickets_require_cashable_wallets_and_keep_entry_source'),
   ('20261116154841','expired_and_departed_promo_principal_returns_to_its_original'),
   ('20261116161707','suspect_promo_chip_dumping_holds_only_attributable_incoming_'),
   ('20261116163759','promo_grant_notices_progress_pushes_and_digest_share_origina'),
   ('20261116190221','promo_winnings_retain_original_source_until_two_times_paid_f'),
   ('20261116200638','tournament_winnings_retain_original_earning_generation_and_c'),
   ('20261116214149','returned_promo_ticket_principal_goes_to_its_original_fund_wi')
  ) required(version,name)
  WHERE NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations installed
   WHERE installed.version=required.version AND installed.name=required.name)
 ) THEN RAISE EXCEPTION 'promo_activation_original_migrations_not_installed';END IF;
 SELECT * INTO dial FROM public.ca_promo_play_through_settings WHERE id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'promo_activation_original_settings_missing';END IF;
 IF dial.enforced_from IS NOT NULL THEN RAISE EXCEPTION 'promo_programme_already_activated';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants) THEN
  RAISE EXCEPTION 'promo_activation_requires_no_existing_grants';
 END IF;
 activation_at:=clock_timestamp();
 UPDATE public.ca_promo_play_through_settings
  SET multiplier=4,expiry_days=30,enforced_from=activation_at,updated_at=activation_at
  WHERE id AND enforced_from IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'promo_activation_settings_changed';END IF;
END $activate$;
COMMIT;
