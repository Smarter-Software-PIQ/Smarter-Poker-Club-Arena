-- Email/text receipts for the 2026-11-05 Tournament Arena Relaunch notice.
-- World Hub's hourly welcome-back route sends them (Resend + Twilio) and marks each here.
alter table public.sp_relaunch_awards
  add column if not exists notify_only boolean not null default false,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error text,
  add column if not exists sms_sent_at timestamptz,
  add column if not exists sms_error text,
  add column if not exists notice_attempts int not null default 0;

-- Fill addresses the same way welcome-back does: email from auth, phone from profile.
update public.sp_relaunch_awards a
   set email = case when u.email ~* '\.invalid$' then null else nullif(btrim(u.email),'') end,
       phone = nullif(btrim(p.phone),'')
  from auth.users u, public.profiles p
 where u.id = a.user_id and p.id = a.user_id;

-- Owner copy (KINGFISH) so Dan sees the notice land; notified only, never paid.
insert into public.sp_relaunch_awards (user_id, status, op_id, notify_only, email, phone)
select p.id, 'awarded', (md5('tournament_relaunch_owner_copy:' || p.id::text))::uuid, true,
       case when u.email ~* '\.invalid$' then null else u.email end, nullif(btrim(p.phone),'')
  from public.profiles p join auth.users u on u.id = p.id
 where p.id = '47965354-0e56-43ef-931c-ddaab82af765'
on conflict (user_id) do nothing;

-- The payer must never pay a notify-only row.
create or replace function public.fn_sp_relaunch_award_guard() returns trigger language plpgsql as $g$
begin
  if new.notify_only and new.transaction_id is not null then
    raise exception 'notify-only relaunch rows are never paid';
  end if;
  return new;
end $g$;
drop trigger if exists trg_sp_relaunch_award_guard on public.sp_relaunch_awards;
create trigger trg_sp_relaunch_award_guard before insert or update on public.sp_relaunch_awards
  for each row execute function public.fn_sp_relaunch_award_guard();

-- What the sender needs: rows with an address whose channel has not gone out.
create or replace function public.fn_sp_relaunch_notice_pending(p_limit int default 200)
returns table(user_id uuid, username text, status text, email text, phone text, need_email boolean, need_sms boolean, club_code text)
language sql security definer set search_path to 'public' as $f$
  select a.user_id, p.username, a.status, a.email, a.phone,
         (a.email is not null and a.email_sent_at is null and coalesce(a.email_error,'') not in ('muted','final')),
         (a.phone is not null and a.sms_sent_at is null and coalesce(a.sms_error,'') not in ('muted','final','undialable','timeout')),
         (select c.club_id::text from clubs c where c.id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4')
    from sp_relaunch_awards a join profiles p on p.id = a.user_id
   where a.notice_attempts < 24
     and ((a.email is not null and a.email_sent_at is null and coalesce(a.email_error,'') not in ('muted','final'))
       or (a.phone is not null and a.sms_sent_at is null and coalesce(a.sms_error,'') not in ('muted','final','undialable','timeout')))
   order by a.notify_only desc, a.created_at
   limit greatest(1, least(p_limit, 500));
$f$;

create or replace function public.fn_sp_relaunch_notice_mark(p_user_id uuid, p_channel text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if p_channel = 'email' then
    update sp_relaunch_awards set email_sent_at = case when p_ok then now() else email_sent_at end,
      email_error = case when p_ok then null else left(p_detail,300) end, notice_attempts = notice_attempts + 1, updated_at = now()
     where user_id = p_user_id;
  elsif p_channel = 'sms' then
    update sp_relaunch_awards set sms_sent_at = case when p_ok then now() else sms_sent_at end,
      sms_error = case when p_ok then null else left(p_detail,300) end, notice_attempts = notice_attempts + 1, updated_at = now()
     where user_id = p_user_id;
  else
    raise exception 'unknown channel %', p_channel;
  end if;
end $f$;

revoke all on function public.fn_sp_relaunch_notice_pending(int) from public, anon, authenticated;
revoke all on function public.fn_sp_relaunch_notice_mark(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.fn_sp_relaunch_notice_pending(int) to service_role;
grant execute on function public.fn_sp_relaunch_notice_mark(uuid, text, boolean, text) to service_role;
