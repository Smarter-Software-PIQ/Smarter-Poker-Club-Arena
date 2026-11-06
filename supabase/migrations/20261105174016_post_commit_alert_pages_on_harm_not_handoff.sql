-- 2026-11-05: ServerTableEngine.post_commit_obligations_pending filed 173 CRITICAL
-- alerts in a day, in bursts of 16-59 at four engine table-ownership handoffs.
-- Every one carried error f06_owner_changed and every one was finished by the
-- outbox projection worker within minutes (0 hands left unfinished in 30 hours).
-- The alert paged on the self-healing case and was silent on the harmful one.
--
-- (1) On arrival, an owner-change handoff is a warning, not a page.
-- (2) A watchdog pages on the real harm: a committed hand whose post-commit
--     work is still not done 10 minutes later, whatever the reason.

create or replace function public.fn_post_commit_handoff_is_a_warning()
returns trigger language plpgsql as $f$
begin
  if new.source = 'ServerTableEngine.post_commit_obligations_pending'
     and new.severity = 'critical'
     and coalesce(new.context->>'error','') = 'f06_owner_changed' then
    new.severity := 'warning';
    new.context := coalesce(new.context,'{}'::jsonb) || jsonb_build_object(
      'reclassified', 'owner-change handoff; the outbox projection worker completes it. fn_post_commit_stranded_watchdog pages if it does not within 10 minutes.');
  end if;
  return new;
end $f$;

drop trigger if exists a2_post_commit_handoff_is_a_warning on public.financial_alerts;
create trigger a2_post_commit_handoff_is_a_warning before insert on public.financial_alerts
  for each row when (new.source = 'ServerTableEngine.post_commit_obligations_pending')
  execute function public.fn_post_commit_handoff_is_a_warning();

create or replace function public.fn_post_commit_stranded_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '60s' as $f$
declare v_n int; v_oldest timestamptz; v_sample jsonb;
begin
  select count(*), min(committed_at),
         coalesce(jsonb_agg(jsonb_build_object('table_id', table_id, 'hand_number', hand_number, 'committed_at', committed_at)) filter (where rn <= 10), '[]')
    into v_n, v_oldest, v_sample
    from (select table_id, hand_number, committed_at, row_number() over (order by committed_at) rn
            from hand_atomic_commits
           where post_commit_payload is not null and post_commit_completed_at is null
             and committed_at < now() - interval '10 minutes') s;

  if v_n > 0 then
    if not exists (select 1 from financial_alerts where source='fn_post_commit_stranded_watchdog' and not resolved) then
      insert into financial_alerts (severity, source, message, context)
      values ('critical','fn_post_commit_stranded_watchdog',
        v_n || ' committed hand(s) still have unfinished post-commit work after 10+ minutes (oldest ' || v_oldest || '). Players'' balances, stats or rake for these hands may be incomplete.',
        jsonb_build_object('stranded', v_n, 'oldest', v_oldest, 'sample', v_sample));
    end if;
  else
    update financial_alerts set resolved = true, resolved_at = now(), resolution = 'no stranded post-commit work remains'
     where source='fn_post_commit_stranded_watchdog' and not resolved;
  end if;
  return jsonb_build_object('stranded', v_n, 'oldest', v_oldest);
end $f$;
revoke all on function public.fn_post_commit_stranded_watchdog() from public, anon, authenticated;

select cron.schedule('post-commit-stranded-watchdog-5m', '*/5 * * * *', 'select public.fn_post_commit_stranded_watchdog()');
