# Continue the November 16 book that has released rakeback and a delivered
# credit bill. The later simulated week already has its separate horse receipt.
migrations=R/'supabase/migrations'
awards=next(migrations.glob('20261104145956_*.sql')).read_text()
q(awards[awards.index('CREATE TABLE IF NOT EXISTS public.sp_signup_welcome_back_awards'):awards.index('CREATE INDEX IF NOT EXISTS sp_signup_welcome_back_awards')])
hardening=next(migrations.glob('20261104184347_*.sql')).read_text()
q(hardening[hardening.index('ALTER TABLE public.sp_signup_welcome_back_awards'):hardening.index('INSERT INTO public.sp_digest_settings')])
totals=next(migrations.glob('20261010073005_*.sql')).read_text()
q(totals[totals.index('CREATE TABLE public.club_member_play_totals ('):totals.index('ALTER TABLE public.club_member_play_totals')])
q((F/'weekly-welcome-source.sql').read_text())
registry=next(migrations.glob('20260904182847_*.sql')).read_text()
q(registry[registry.index('CREATE TABLE IF NOT EXISTS public.ca_declared_money_triggers'):registry.index('COMMENT ON TABLE public.ca_declared_money_triggers')])
q(next(migrations.glob('20261116160732_*.sql')).read_text())
kings='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
welcome='SELECT smarter_private.weekly_kings_welcome_due()'
assert not one(welcome), 'no award evaluation before completed promo'
clock('2026-11-16 17:00:00Z')
q(f"""
 INSERT INTO public.clubs(id,name,owner_id,union_id,is_union,chip_treasury)
 VALUES('{kings}','KINGS fixture',rr.u('U.boss'),'{mid}',false,0);
 INSERT INTO public.union_clubs(union_id,club_id,joined_at,club_commission_rate)
 VALUES('{mid}','{kings}',rr.ws(),0.9);
 SELECT rr.person(n) FROM unnest(ARRAY['new_member','played','funded','late_member','horse_member','racing_hand','racing_credit','staff','other_member']) n;
 UPDATE auth.users SET email='person+'||id::text||'@fixture.org'
   WHERE id IN (SELECT rr.u(n) FROM unnest(ARRAY['new_member','played','funded','late_member','horse_member','racing_hand','racing_credit','staff','other_member']) n);
 UPDATE public.profiles SET created_at=rr.ws()-interval '10 days' WHERE id IN (SELECT id FROM auth.users WHERE email LIKE '%@fixture.org');
 UPDATE public.profiles SET is_horse=true WHERE id=rr.u('horse_member');
 INSERT INTO public.club_members(club_id,user_id,role,status,is_active,membership_lifecycle_status,joined_at)
 SELECT '{kings}',rr.u(n),CASE WHEN n='staff' THEN 'admin' ELSE 'player' END,'active',true,'active',CASE WHEN n='late_member' THEN rr.we() ELSE rr.ws() END
 FROM unnest(ARRAY['new_member','played','funded','late_member','horse_member','racing_hand','racing_credit','staff']) n;
 INSERT INTO public.club_members(club_id,user_id,role,status,is_active,membership_lifecycle_status,joined_at)
 VALUES('{mid}',rr.u('other_member'),'player','active',true,'active',rr.ws());
 INSERT INTO public.club_member_play_totals(club_id,user_id,mtt_hands) VALUES('{kings}',rr.u('played'),1);
 BEGIN;
 -- The earlier regression exercised the pre-change empty Midway wallet on
 -- this isolated board. Its zero-amount receipt has no disbursements.
 DELETE FROM public.union_weekly_horse_promo_runs WHERE union_id='{mid}' AND period_end=rr.we()
   AND paid=0 AND eligible_wallets=0 AND result->>'eligibility'='horses_that_generated_rake_this_week';
 SELECT public.fn_ca_declare_ledger('promo','club_treasury',rr.u('T'),NULL,'weekly-welcome-fixture-funding',ARRAY['clubs']);
 UPDATE public.clubs SET chip_treasury=chip_treasury-200 WHERE id=rr.u('T');
 UPDATE public.union_wallets SET promo_wallet=200 WHERE union_id='{mid}';
 COMMIT;
 SELECT public.fn_promo_disburse('union','{mid}','player',rr.u('funded'),1,'fixture prior credit','{kings}',rr.u('prior-credit'));
 """)
assert not one(welcome), 'a funded account and other candidates stay untouched before the horse receipt'
hourly=json.loads(one("SELECT public.fn_sp_signup_welcome_back_run(50,'2026-10-01')"))
assert hourly['awarded_count']==1 and hourly['awarded'][0]['user_id']==one("SELECT rr.u('other_member')"),hourly
assert json.loads(one('SELECT public.fn_midway_weekly_horse_promo(rr.ws(),rr.we())'))['success']
assert one(f"SELECT count(*)=0 FROM public.sp_signup_welcome_back_awards WHERE club_id='{kings}'")=='t'
clock('2026-11-17 04:00:00Z')  # the same owner resumes past its book-only 12-hour deadline
# Hold a real first-hand aggregate and a real incoming chip in another open
# transaction. The owner must defer, then re-read both committed histories.
writer=subprocess.Popen([str(A.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',DB,'-c',f"""
 SET application_name='welcome-fixture-incoming';
 INSERT INTO public.club_member_play_totals(club_id,user_id,hands) VALUES('{kings}',rr.u('racing_hand'),1);
 SELECT public.fn_promo_disburse('union','{mid}','player',rr.u('racing_credit'),1,'different incoming credit','{kings}',rr.u('racing-credit'));
 SELECT pg_sleep(3);
 """],env=E,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
try:
    for _ in range(100):
        if one("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='welcome-fixture-incoming' AND wait_event='PgSleep')")=='t':
            break
        time.sleep(0.04)
    else:
        raise AssertionError('concurrent incoming writers never reached their commit barrier')
    busy=q(welcome,check=False)
    assert busy.returncode and ('busy' in busy.stderr or 'could not obtain lock' in busy.stderr),busy.stderr
finally:
    errors=writer.communicate(timeout=10)[1]
    assert writer.returncode==0,errors
before_amount=one(f"SELECT promo_wallet FROM public.union_wallets WHERE union_id='{mid}'")
result=json.loads(one('SELECT smarter_private.weekly_union_books_due()'))
assert result['stage']=='weekly_kings_welcome_complete' and result['paid_players']==1 and result['paid']==25,result
assert one(f"""SELECT count(*)=1 AND bool_and(a.user_id=rr.u('new_member') AND a.club_id='{kings}' AND a.union_id='{mid}'
  AND t.transaction_type='promo_disbursement' AND t.amount=25 AND t.to_user_id=a.user_id AND t.club_id=a.club_id)
  FROM public.sp_signup_welcome_back_awards a JOIN public.chip_transactions t ON t.id=a.transaction_id WHERE a.club_id='{kings}'""")=='t'
assert one(f"SELECT promo_wallet={before_amount}::numeric-25 FROM public.union_wallets WHERE union_id='{mid}'")=='t'
assert not one(welcome)
assert one(f"SELECT count(*) FROM public.sp_signup_welcome_back_awards WHERE club_id='{kings}'")=='1'
case('the weekly owner checks KINGS joins after completed rakeback, real credit Messenger and horse promo; only the unfunded zero-hand human receives 25 from Midway, once, in the KINGS wallet')
