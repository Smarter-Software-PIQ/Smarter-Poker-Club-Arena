-- 2026-11-05 Tournament Arena Relaunch: every real player gets 25 chips once from the
-- Midway Union promo wallet. Players with no Midway Union club seat are recorded as owed
-- and paid automatically the first time they hold one (same rule as welcome-back).
create table if not exists public.sp_relaunch_awards (
  user_id uuid primary key references public.profiles(id),
  status text not null default 'owed' check (status in ('owed','awarded','failed')),
  amount numeric not null default 25,
  op_id uuid not null,
  club_id uuid,
  transaction_id uuid,
  last_error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  awarded_at timestamptz
);
alter table public.sp_relaunch_awards enable row level security;

-- Seed: everyone already paid last night is marked awarded (never paid twice).
insert into public.sp_relaunch_awards (user_id, status, op_id, club_id, transaction_id, awarded_at)
select distinct on (c.to_user_id) c.to_user_id, 'awarded', (c.metadata->>'op_id')::uuid, c.club_id, c.id, c.created_at
  from public.chip_transactions c
 where c.transaction_type = 'promo_disbursement' and c.notes ilike 'Tournament Arena Relaunch%' and c.to_user_id is not null
 order by c.to_user_id, c.created_at
on conflict (user_id) do nothing;

-- Seed: every other real player is owed.
insert into public.sp_relaunch_awards (user_id, status, op_id)
select h.id, 'owed', (md5('tournament_relaunch_20261105:' || h.id::text))::uuid
  from smarter_private.sp_real_humans h
on conflict (user_id) do nothing;

create or replace function public.fn_sp_relaunch_award_run()
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $f$
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
  -- New real sign-ups after the relaunch are not part of this one-time promotion.
  for a in select * from sp_relaunch_awards where status in ('owed','failed') and attempts < 50 order by created_at for update skip locked loop
    -- Belt and braces: never pay someone the ledger already shows as paid.
    if exists (select 1 from chip_transactions c where c.to_user_id = a.user_id
                 and c.transaction_type = 'promo_disbursement' and c.notes ilike 'Tournament Arena Relaunch%') then
      update sp_relaunch_awards set status='awarded', updated_at=now(), awarded_at=coalesce(awarded_at, now()) where user_id=a.user_id;
      continue;
    end if;
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
    else
      update sp_relaunch_awards set status='failed', last_error=v_res->>'error', attempts=attempts+1, updated_at=now() where user_id=a.user_id;
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('paid', v_paid, 'waiting_for_club', v_waiting, 'failed', v_failed, 'ran_at', now());
end $f$;
revoke all on function public.fn_sp_relaunch_award_run() from public, anon, authenticated;

select cron.schedule('sp-relaunch-award-15m', '*/15 * * * *', 'select public.fn_sp_relaunch_award_run()');
