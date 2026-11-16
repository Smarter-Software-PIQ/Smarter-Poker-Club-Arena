# Exercise notification preparation on the real runner's own committed week.
# Transport tables are minimal local endpoints; all money evidence is original.
q("CREATE DATABASE credit_notices TEMPLATE postgres")
try:
    DB='credit_notices'
    q("""CREATE TABLE public.push_outbox(id uuid PRIMARY KEY,recipient_user_id uuid,event text,title text,body text,url text,tag text,related_entity_id uuid);
         CREATE TABLE public.notification_preferences(user_id uuid,email_enabled boolean,mute_all boolean);
         ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
           ADD COLUMN IF NOT EXISTS banned_until timestamptz,ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
         UPDATE auth.users SET email_confirmed_at=now(),email=replace(email,'fixture.invalid','fixture.smarter.poker');
         UPDATE public.profiles SET is_horse=true WHERE id=rr.u('OP1');
         UPDATE auth.users SET email_confirmed_at=NULL WHERE id=rr.u('WP1');
         INSERT INTO public.notification_preferences VALUES(rr.u('TP'),false,false);""")
    q(next((R/'supabase/migrations').glob('20261116161022_*.sql')).read_text())
    q("SELECT smarter_private.prepare_weekly_rakeback_credit_notices() FROM generate_series(1,4)")
    assert one("SELECT count(*)=3 AND sum(amount)=666 FROM smarter_private.weekly_rakeback_credit_notices WHERE kind='club'")=='t'
    assert one("SELECT count(*)=2 AND sum(amount)=84 FROM smarter_private.weekly_rakeback_credit_notices WHERE kind='agent'")=='t', q("SELECT kind,count(*),sum(amount) FROM smarter_private.weekly_rakeback_credit_notices GROUP BY kind").stdout
    assert one("SELECT count(*)=7 FROM smarter_private.weekly_rakeback_credit_notices WHERE kind='player'")=='t'
    assert one("SELECT NOT EXISTS(SELECT FROM smarter_private.weekly_rakeback_credit_notices WHERE user_id=rr.u('OP1')) AND (SELECT count(*) FROM public.push_outbox)=12")=='t'
    q("SELECT * FROM public.claim_weekly_rakeback_credit_emails(); SELECT * FROM public.claim_weekly_rakeback_credit_emails();")
    assert one("SELECT count(*)=2 FROM smarter_private.weekly_rakeback_credit_notices WHERE email_status='skipped' AND user_id IN(rr.u('TP'),rr.u('WP1'))")=='t'
    assert one("SELECT count(*)=0 FROM public.claim_weekly_rakeback_credit_emails()")=='t'
    q("SELECT public.finish_weekly_rakeback_credit_email(receipt_id,email_claim,'provider-id',NULL) FROM smarter_private.weekly_rakeback_credit_notices WHERE email_status='sending'")
    assert one("SELECT count(*)=10 FROM smarter_private.weekly_rakeback_credit_notices WHERE email_status='sent'")=='t'
    q("UPDATE smarter_private.weekly_rakeback_notice_rounds SET prepared_at=NULL; SELECT smarter_private.prepare_weekly_rakeback_credit_notices() FROM generate_series(1,4)")
    assert one("SELECT (SELECT count(*) FROM public.push_outbox)=12 AND NOT EXISTS(SELECT FROM public.claim_weekly_rakeback_credit_emails())")=='t'
    # A seeded account with an enrolled device uses the ordinary player
    # notification. Its verified synthetic mailbox is never a delivery address.
    q("""ALTER TABLE public.push_outbox ADD COLUMN status text DEFAULT 'pending',ADD COLUMN failure_reason text;
         CREATE TABLE public.push_subscriptions(user_id uuid,is_active boolean);
         INSERT INTO public.push_subscriptions VALUES(rr.u('OP1'),true);
         UPDATE auth.users SET email='horse-fixture@horses.smarter.poker' WHERE id=rr.u('OP1');""")
    q(next((R/'supabase/migrations').glob('20261116164202_*.sql')).read_text())
    q("SELECT smarter_private.prepare_weekly_rakeback_credit_notices() FROM generate_series(1,4)")
    assert one("SELECT count(*)=1 AND bool_and(n.kind='player' AND n.title='Player Rakeback' AND n.email_status='skipped' AND p.status='pending' AND p.title='Player Rakeback') FROM smarter_private.weekly_rakeback_credit_notices n JOIN public.push_outbox p ON p.id=n.push_id WHERE n.user_id=rr.u('OP1')")=='t'
    assert one("SELECT count(*)=13 FROM public.push_outbox")=='t'
    assert one("SELECT count(*)=8 FROM smarter_private.weekly_rakeback_credit_notices WHERE kind='player'")=='t'
    assert one("SELECT count(*)=0 FROM public.claim_weekly_rakeback_credit_emails()")=='t'
    # Post-deploy fixtures can carry a verified auth identifier without an email domain.
    q("UPDATE auth.users SET email='postdeploy-fixture' WHERE id=rr.u('WP1'); UPDATE auth.users SET email_confirmed_at=now() WHERE id=rr.u('WP1')")
    assert one("SELECT smarter_private.weekly_rakeback_email_destination(rr.u('WP1'),rr.u('O'),'player') IS NULL")=='t'
    q("UPDATE auth.users SET email='verified@fixture.smarter.poker' WHERE id=rr.u('OP1')")
    assert one("SELECT smarter_private.weekly_rakeback_email_destination(rr.u('OP1'),rr.u('O'),'player')='verified@fixture.smarter.poker'")=='t'
    case('all paid player accounts share one label; only an actual enrolled device or verified nonsynthetic address is a delivery destination')
    case('posted rakeback notices: club bank, earned agent commission, human player wallet, deduplicated delivery, verified address and preference checks')
finally:
    DB='postgres'
    q("DROP DATABASE credit_notices")
