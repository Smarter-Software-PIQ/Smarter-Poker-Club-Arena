-- Player campaigns (tournament relaunch, owner announcements): never notify
-- the same player twice, never text the same phone twice per campaign, and
-- tell a late-paid relaunch player when their chips land (Dan, 2026-11-05).
-- 1. Two agents each re-queued Dan's relaunch push by hand (19:41 and 20:16
--    UTC), so he got it twice; nothing stopped a second campaign notification
--    or push. Now a second campaign notification for the same player is
--    dropped, and a second campaign push with the same title is recorded as
--    skipped (duplicate_campaign_push).
-- 2. One phone sat on four accounts, so a blast texted it up to four times and
--    the carrier began refusing the platform number. The pending readers hand
--    out each normalized phone once per campaign: the row already texted
--    keeps it, otherwise the earliest row.
-- 3. A relaunch player paid later (on joining a Midway Union club) got no word
--    the chips arrived. The award runner now raises one "25 Chips Just Landed"
--    notification (and its push) per paid row.

create or replace function public.fn_sp_phone_key(p_phone text)
returns text language sql immutable set search_path = public as $$
  select case
    when d = '' then null
    when length(d) = 11 and left(d, 1) = '1' then substr(d, 2)
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') d) s
$$;

alter table public.sp_relaunch_awards add column if not exists landed_notified_at timestamptz;

create or replace function public.fn_campaign_notification_once()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.notifications n
              where n.user_id = new.user_id and n.type = new.type
                and coalesce(n.data->>'announcement', '') = coalesce(new.data->>'announcement', '')) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists trg_campaign_notification_once on public.notifications;
create trigger trg_campaign_notification_once
  before insert on public.notifications for each row
  when (new.type in ('tournament_relaunch', 'relaunch_chips_landed', 'player_announcement', 'announcement_chips_landed'))
  execute function public.fn_campaign_notification_once();

create or replace function public.fn_campaign_push_once()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and exists (
       select 1 from public.push_outbox o
        where o.recipient_user_id = new.recipient_user_id and o.event = new.event
          and o.title is not distinct from new.title
          and o.status in ('pending', 'processing', 'sent')) then
    new.status := 'skipped';
    new.failure_reason := 'duplicate_campaign_push';
  end if;
  return new;
end $$;

drop trigger if exists trg_campaign_push_once on public.push_outbox;
create trigger trg_campaign_push_once
  before insert on public.push_outbox for each row
  when (new.event in ('tournament_relaunch', 'relaunch_chips_landed', 'player_announcement', 'announcement_chips_landed'))
  execute function public.fn_campaign_push_once();

revoke all on function public.fn_campaign_notification_once() from public, anon, authenticated;
revoke all on function public.fn_campaign_push_once() from public, anon, authenticated;

create or replace function public.fn_sp_relaunch_notice_pending(p_limit integer default 200)
returns table(user_id uuid, username text, status text, email text, phone text, need_email boolean, need_sms boolean, club_code text)
language sql security definer set search_path = public as $$
  with phone_owner as (
    select distinct on (public.fn_sp_phone_key(x.phone)) public.fn_sp_phone_key(x.phone) pk, x.user_id
      from sp_relaunch_awards x where public.fn_sp_phone_key(x.phone) is not null
     order by public.fn_sp_phone_key(x.phone), (x.sms_sent_at is null), x.created_at, x.user_id
  ), q as (
    select a.*, p.username,
           (a.email is not null and a.email_sent_at is null and coalesce(a.email_error,'') not in ('muted','final')) ne,
           (a.phone is not null and a.sms_sent_at is null
             and coalesce(a.sms_error,'') not in ('muted','final','undialable','timeout','duplicate_phone')
             and exists (select 1 from phone_owner o where o.pk = public.fn_sp_phone_key(a.phone) and o.user_id = a.user_id)) ns
      from sp_relaunch_awards a join profiles p on p.id = a.user_id
     where a.notice_attempts < 24
  )
  select q.user_id, q.username, q.status, q.email, q.phone, q.ne, q.ns,
         (select c.club_id::text from clubs c where c.id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4')
    from q where q.ne or q.ns
   order by q.notify_only desc, q.created_at
   limit greatest(1, least(p_limit, 500));
$$;

create or replace function public.fn_sp_announcement_notice_pending(p_limit integer default 200)
returns table(announcement_id uuid, slug text, user_id uuid, username text, status text, title text, body text, sms_body text, chips numeric, link text, email text, phone text, need_email boolean, need_sms boolean, club_code text)
language sql security definer set search_path = public as $$
  with phone_owner as (
    select distinct on (x.announcement_id, public.fn_sp_phone_key(x.phone)) x.announcement_id, public.fn_sp_phone_key(x.phone) pk, x.user_id
      from sp_player_announcement_recipients x where public.fn_sp_phone_key(x.phone) is not null
     order by x.announcement_id, public.fn_sp_phone_key(x.phone), (x.sms_sent_at is null), x.created_at, x.user_id
  ), q as (
    select r.*, a.slug, a.title, a.body, a.sms_body, a.chips, a.link, a.created_at a_created, p.username,
           (r.email is not null and r.email_sent_at is null and coalesce(r.email_error,'') not in ('muted','final')) ne,
           (r.phone is not null and r.sms_sent_at is null
             and coalesce(r.sms_error,'') not in ('muted','final','undialable','timeout','duplicate_phone')
             and exists (select 1 from phone_owner o where o.announcement_id = r.announcement_id
                           and o.pk = public.fn_sp_phone_key(r.phone) and o.user_id = r.user_id)) ns
      from sp_player_announcement_recipients r join sp_player_announcements a on a.id = r.announcement_id
      join profiles p on p.id = r.user_id
     where r.notice_attempts < 24
  )
  select q.announcement_id, q.slug, q.user_id, q.username, q.status, q.title, q.body, q.sms_body, q.chips, q.link, q.email, q.phone, q.ne, q.ns,
         (select c.club_id::text from clubs c where c.id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4')
    from q where q.ne or q.ns
   order by q.a_created, q.created_at
   limit greatest(1, least(p_limit, 500));
$$;

create or replace function public.fn_sp_relaunch_award_run()
returns jsonb language plpgsql security definer set search_path = public set statement_timeout = '120s' as $function$
declare
  v_union constant uuid := 'fade0000-0000-0000-0000-000000000001';
  a record; v_club uuid; v_res jsonb; v_paid int := 0; v_waiting int := 0; v_failed int := 0;
begin
  if not public.fn_caller_is_engine() then
    raise exception 'fn_sp_relaunch_award_run is service_role only' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('fn_sp_relaunch_award_run')) then
    return jsonb_build_object('already_running', true);
  end if;
  for a in select * from sp_relaunch_awards where status in ('owed','failed') and attempts < 50 order by created_at for update skip locked loop
    if exists (select 1 from chip_transactions c where c.to_user_id = a.user_id
                 and c.transaction_type = 'promo_disbursement' and c.notes ilike 'Tournament Arena Relaunch%') then
      update sp_relaunch_awards set status='awarded', updated_at=now(), awarded_at=coalesce(awarded_at, now()) where user_id=a.user_id;
      continue;
    end if;
    v_club := null;
    select cm.club_id into v_club from club_members cm join union_clubs uc on uc.club_id=cm.club_id and uc.union_id=v_union
     where cm.user_id=a.user_id and coalesce(cm.status,'active') in ('active','approved')
     order by cm.updated_at desc nulls last limit 1;
    if v_club is null then v_waiting := v_waiting + 1; continue; end if;
    v_res := public.fn_promo_disburse('union', v_union, 'player', a.user_id, a.amount,
      'Tournament Arena Relaunch - 25 chips from the Midway Union for the delay', v_club, a.op_id);
    if coalesce((v_res->>'success')::boolean, false) then
      update sp_relaunch_awards set status='awarded', club_id=v_club, transaction_id=(v_res->>'transaction_id')::uuid,
        awarded_at=now(), updated_at=now(), last_error=null, attempts=attempts+1 where user_id=a.user_id;
      v_paid := v_paid + 1;
      if a.landed_notified_at is null and not a.notify_only then
        begin
          perform public.fn_raise_notification(a.user_id, 'relaunch_chips_landed', '25 Chips Just Landed In Your Wallet',
            'Your 25 chips from the Midway Union for the Tournament Arena update are in your wallet. Good luck out there!',
            '/hub/club-arena/', jsonb_build_object('amount', a.amount, 'club_id', v_club));
          update sp_relaunch_awards set landed_notified_at = now() where user_id = a.user_id;
        exception when others then null;
        end;
      end if;
    else
      update sp_relaunch_awards set status='failed', last_error=v_res->>'error', attempts=attempts+1, updated_at=now() where user_id=a.user_id;
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('paid', v_paid, 'waiting_for_club', v_waiting, 'failed', v_failed, 'ran_at', now());
end $function$;