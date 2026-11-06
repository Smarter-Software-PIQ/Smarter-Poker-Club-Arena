create table if not exists public.sp_player_announcements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  title text not null,
  body text not null,
  sms_body text,
  chips numeric not null default 0 check (chips >= 0 and chips <= 1000),
  requires_ok boolean not null default true,
  audience text not null default 'real_humans' check (audience in ('real_humans','owner_only')),
  link text not null default '/hub/club-arena/',
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.sp_player_announcements enable row level security;

create table if not exists public.sp_player_announcement_recipients (
  announcement_id uuid not null references public.sp_player_announcements(id),
  user_id uuid not null references public.profiles(id),
  status text not null check (status in ('notified','owed','awarded','failed')),
  op_id uuid, club_id uuid, transaction_id uuid, last_error text,
  attempts int not null default 0,
  email text, phone text,
  email_sent_at timestamptz, email_error text,
  sms_sent_at timestamptz, sms_error text,
  notice_attempts int not null default 0,
  push_raised_at timestamptz, landed_notified_at timestamptz, awarded_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.sp_player_announcement_recipients enable row level security;

create or replace function public.fn_sp_announcement_award_run()
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $f$
declare
  v_union constant uuid := 'fade0000-0000-0000-0000-000000000001';
  r record; v_club uuid; v_res jsonb; v_paid int := 0; v_wait int := 0; v_fail int := 0; v_amt text;
begin
  if not public.fn_caller_is_engine() then raise exception 'service_role only' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtext('fn_sp_announcement_award_run')) then return jsonb_build_object('already_running', true); end if;
  for r in select x.*, a.slug, a.chips, a.title from sp_player_announcement_recipients x join sp_player_announcements a on a.id = x.announcement_id
            where x.status in ('owed','failed') and x.attempts < 50 order by x.created_at for update of x skip locked loop
    if exists (select 1 from chip_transactions c where c.transaction_type='promo_disbursement' and c.metadata->>'op_id' = r.op_id::text) then
      update sp_player_announcement_recipients set status='awarded', awarded_at=coalesce(awarded_at,now()), updated_at=now()
       where announcement_id=r.announcement_id and user_id=r.user_id;
      continue;
    end if;
    v_club := null;
    select cm.club_id into v_club from club_members cm join union_clubs uc on uc.club_id=cm.club_id and uc.union_id=v_union
     where cm.user_id=r.user_id and coalesce(cm.status,'active') in ('active','approved') order by cm.updated_at desc nulls last limit 1;
    if v_club is null then v_wait := v_wait + 1; continue; end if;
    begin
      v_res := public.fn_promo_disburse('union', v_union, 'player', r.user_id, r.chips, r.title || ' - ' || r.chips || ' chips from the Midway Union', v_club, r.op_id);
    exception when others then v_res := jsonb_build_object('success', false, 'error', sqlerrm);
    end;
    if coalesce((v_res->>'success')::boolean,false) then
      update sp_player_announcement_recipients set status='awarded', club_id=v_club, transaction_id=nullif(v_res->>'transaction_id','')::uuid,
        awarded_at=now(), updated_at=now(), last_error=null, attempts=attempts+1 where announcement_id=r.announcement_id and user_id=r.user_id;
      v_paid := v_paid + 1;
      if r.landed_notified_at is null and r.push_raised_at is not null and r.push_raised_at < now() - interval '1 minute' then
        v_amt := to_char(r.chips, 'FM999990.##');
        begin
          perform public.fn_raise_notification(r.user_id, 'announcement_chips_landed', v_amt || ' Chips Just Landed In Your Wallet',
            'Your ' || v_amt || ' chips from the Midway Union (' || r.title || ') are in your wallet. Good luck out there!', '/hub/club-arena/',
            jsonb_build_object('announcement', r.slug, 'amount', r.chips, 'club_id', v_club));
          update sp_player_announcement_recipients set landed_notified_at=now() where announcement_id=r.announcement_id and user_id=r.user_id;
        exception when others then null;
        end;
      end if;
    else
      update sp_player_announcement_recipients set status='failed', last_error=left(v_res->>'error',300), attempts=attempts+1, updated_at=now()
       where announcement_id=r.announcement_id and user_id=r.user_id;
      v_fail := v_fail + 1;
    end if;
  end loop;
  return jsonb_build_object('paid', v_paid, 'waiting_for_club', v_wait, 'failed', v_fail, 'ran_at', now());
end $f$;

create or replace function public.fn_sp_announcement_reach(p_slug text)
returns jsonb language sql security definer set search_path to 'public' as $f$
  select jsonb_build_object('slug', a.slug, 'chips', a.chips,
    'recipients', count(r.user_id),
    'paid', count(*) filter (where r.status='awarded'),
    'waiting_for_club', count(*) filter (where r.status='owed'),
    'failed_to_pay', count(*) filter (where r.status='failed'),
    'in_app_and_push_raised', count(*) filter (where r.push_raised_at is not null),
    'with_push_device', count(*) filter (where exists (select 1 from push_subscriptions s where s.user_id=r.user_id)),
    'emails_sent', count(*) filter (where r.email_sent_at is not null), 'emails_pending', count(*) filter (where r.email is not null and r.email_sent_at is null),
    'texts_sent', count(*) filter (where r.sms_sent_at is not null), 'texts_pending', count(*) filter (where r.phone is not null and r.sms_sent_at is null),
    'no_email_or_phone', count(*) filter (where r.user_id is not null and r.email is null and r.phone is null),
    'chips_landed_notices', count(*) filter (where r.landed_notified_at is not null))
  from sp_player_announcements a left join sp_player_announcement_recipients r on r.announcement_id=a.id
  where a.slug = p_slug group by a.slug, a.chips;
$f$;

create or replace function public.fn_sp_announce(p_slug text, p_title text, p_body text, p_chips numeric default 0,
  p_requires_ok boolean default true, p_audience text default 'real_humans', p_sms_body text default null)
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $f$
declare v_id uuid; v_actor uuid := auth.uid(); r record;
begin
  if v_actor is not null and not exists (select 1 from unions u where u.id='fade0000-0000-0000-0000-000000000001' and u.owner_id=v_actor) then
    raise exception 'only the union owner can announce' using errcode='42501';
  end if;
  insert into sp_player_announcements(slug,title,body,sms_body,chips,requires_ok,audience,created_by)
  values (p_slug,p_title,p_body,p_sms_body,coalesce(p_chips,0),coalesce(p_requires_ok,true),coalesce(p_audience,'real_humans'),v_actor)
  returning id into v_id;

  insert into sp_player_announcement_recipients(announcement_id,user_id,status,op_id,email,phone)
  select v_id, x.id, case when coalesce(p_chips,0) > 0 then 'owed' else 'notified' end,
         case when coalesce(p_chips,0) > 0 then md5(p_slug || ':' || x.id::text)::uuid end,
         case when u.email ~* '\.invalid$' then null else nullif(btrim(u.email),'') end, nullif(btrim(p.phone),'')
    from (select h.id from smarter_private.sp_real_humans h where p_audience = 'real_humans'
          union select '47965354-0e56-43ef-931c-ddaab82af765'::uuid) x
    join profiles p on p.id = x.id left join auth.users u on u.id = x.id
  on conflict do nothing;

  if coalesce(p_requires_ok,true) then
    insert into ca_player_notices(slug,title,body,ok_label,audience,active,starts_at,requires_promo_op_prefix)
    values (p_slug, p_title, p_body, 'OK', case when p_audience='owner_only' then 'everyone' else 'real_humans' end, true, now(),
            case when coalesce(p_chips,0) > 0 then p_slug || ':' end);
  end if;

  for r in select user_id from sp_player_announcement_recipients where announcement_id = v_id loop
    begin
      perform public.fn_raise_notification(r.user_id, 'player_announcement', p_title, p_body, '/hub/club-arena/',
        jsonb_build_object('announcement', p_slug, 'chips', coalesce(p_chips,0)));
      update sp_player_announcement_recipients set push_raised_at = now() where announcement_id = v_id and user_id = r.user_id;
    exception when others then null;
    end;
  end loop;

  if coalesce(p_chips,0) > 0 then perform public.fn_sp_announcement_award_run(); end if;
  return public.fn_sp_announcement_reach(p_slug);
end $f$;

create or replace function public.fn_sp_announcement_notice_pending(p_limit int default 200)
returns table(announcement_id uuid, slug text, user_id uuid, username text, status text, title text, body text, sms_body text,
              chips numeric, link text, email text, phone text, need_email boolean, need_sms boolean, club_code text)
language sql security definer set search_path to 'public' as $f$
  select r.announcement_id, a.slug, r.user_id, p.username, r.status, a.title, a.body, a.sms_body, a.chips, a.link, r.email, r.phone,
    (r.email is not null and r.email_sent_at is null and coalesce(r.email_error,'') not in ('muted','final')),
    (r.phone is not null and r.sms_sent_at is null and coalesce(r.sms_error,'') not in ('muted','final','undialable','timeout')),
    (select c.club_id::text from clubs c where c.id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4')
  from sp_player_announcement_recipients r join sp_player_announcements a on a.id=r.announcement_id join profiles p on p.id=r.user_id
  where r.notice_attempts < 24
    and ((r.email is not null and r.email_sent_at is null and coalesce(r.email_error,'') not in ('muted','final'))
      or (r.phone is not null and r.sms_sent_at is null and coalesce(r.sms_error,'') not in ('muted','final','undialable','timeout')))
  order by a.created_at, r.created_at limit greatest(1, least(p_limit, 500));
$f$;

create or replace function public.fn_sp_announcement_notice_mark(p_announcement_id uuid, p_user_id uuid, p_channel text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if p_channel = 'email' then
    update sp_player_announcement_recipients set email_sent_at = case when p_ok then now() else email_sent_at end,
      email_error = case when p_ok then null else left(p_detail,300) end, notice_attempts = notice_attempts+1, updated_at = now()
     where announcement_id = p_announcement_id and user_id = p_user_id;
  elsif p_channel = 'sms' then
    update sp_player_announcement_recipients set sms_sent_at = case when p_ok then now() else sms_sent_at end,
      sms_error = case when p_ok then null else left(p_detail,300) end, notice_attempts = notice_attempts+1, updated_at = now()
     where announcement_id = p_announcement_id and user_id = p_user_id;
  else raise exception 'unknown channel %', p_channel; end if;
end $f$;

revoke all on function public.fn_sp_announcement_award_run() from public, anon, authenticated;
revoke all on function public.fn_sp_announcement_notice_pending(int) from public, anon, authenticated;
revoke all on function public.fn_sp_announcement_notice_mark(uuid,uuid,text,boolean,text) from public, anon, authenticated;
revoke all on function public.fn_sp_announce(text,text,text,numeric,boolean,text,text) from public, anon;
revoke all on function public.fn_sp_announcement_reach(text) from public, anon;
grant execute on function public.fn_sp_announcement_notice_pending(int) to service_role;
grant execute on function public.fn_sp_announcement_notice_mark(uuid,uuid,text,boolean,text) to service_role;
grant execute on function public.fn_sp_announce(text,text,text,numeric,boolean,text,text) to authenticated, service_role;
grant execute on function public.fn_sp_announcement_reach(text) to authenticated, service_role;

select cron.schedule('sp-announcement-award-15m', '*/15 * * * *', 'select public.fn_sp_announcement_award_run()');
