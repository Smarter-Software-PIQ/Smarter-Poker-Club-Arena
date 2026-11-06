-- Dan, 2026-11-05: a text marked "sent" only proved Twilio accepted it. Twilio's
-- final carrier result (delivered / undelivered + error code) now lands here via
-- the /api/webhooks/twilio-status callback, so every platform text can be checked.
create table if not exists public.sms_delivery_receipts (
  sid text primary key,
  to_number text,
  status text not null,
  error_code integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sms_delivery_receipts enable row level security;
revoke all on public.sms_delivery_receipts from anon, authenticated;
create index if not exists sms_delivery_receipts_to_idx on public.sms_delivery_receipts (to_number, updated_at desc);

alter table public.sp_relaunch_awards add column if not exists sms_sid text;

CREATE OR REPLACE FUNCTION public.fn_sp_relaunch_notice_mark(p_user_id uuid, p_channel text, p_ok boolean, p_detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_channel = 'email' then
    update sp_relaunch_awards set email_sent_at = case when p_ok then now() else email_sent_at end,
      email_error = case when p_ok then null else left(p_detail,300) end, notice_attempts = notice_attempts + 1, updated_at = now()
     where user_id = p_user_id;
  elsif p_channel = 'sms' then
    -- On success p_detail carries Twilio's message id, so the carrier result can be joined later.
    update sp_relaunch_awards set sms_sent_at = case when p_ok then now() else sms_sent_at end,
      sms_sid = case when p_ok and p_detail is not null then left(p_detail,64) else sms_sid end,
      sms_error = case when p_ok then null else left(p_detail,300) end, notice_attempts = notice_attempts + 1, updated_at = now()
     where user_id = p_user_id;
  else
    raise exception 'unknown channel %', p_channel;
  end if;
end $function$;
revoke all on function public.fn_sp_relaunch_notice_mark(uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function public.fn_sp_relaunch_notice_mark(uuid,text,boolean,text) to service_role;