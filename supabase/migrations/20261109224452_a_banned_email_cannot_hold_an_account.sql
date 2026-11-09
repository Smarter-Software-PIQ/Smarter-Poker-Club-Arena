-- A person removed from the platform cannot come back under the same mailbox.
-- The ban is enforced where an account is born (auth.users), so every door
-- (email signup, OAuth, admin invite, email change) meets the same gate.

CREATE TABLE IF NOT EXISTS public.banned_signup_emails (
  email_key         text PRIMARY KEY,
  reason            text NOT NULL,
  banned_profile_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.banned_signup_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.banned_signup_emails FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.banned_signup_emails IS
  'Mailboxes that may never hold an account. email_key is fn_signup_email_key(email): lower case, +tag removed, Gmail dots removed. Enforced by auth.users trigger a_banned_email_cannot_hold_an_account.';

-- One mailbox, one key: case, +tags and Gmail dots do not make a new person.
CREATE OR REPLACE FUNCTION public.fn_signup_email_key(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' in p_email) = 0 THEN NULL
    WHEN lower(btrim(split_part(p_email, '@', 2))) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(lower(btrim(split_part(p_email, '@', 1))), '+', 1), '.', '') || '@gmail.com'
    ELSE split_part(lower(btrim(split_part(p_email, '@', 1))), '+', 1)
         || '@' || lower(btrim(split_part(p_email, '@', 2)))
  END
$function$;

CREATE OR REPLACE FUNCTION public.fn_a_banned_email_cannot_hold_an_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.banned_signup_emails b
              WHERE b.email_key = public.fn_signup_email_key(NEW.email)) THEN
    RAISE EXCEPTION 'SIGNUP_BANNED: this email address cannot hold an account'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_a_banned_email_cannot_hold_an_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_banned_email_cannot_hold_an_account ON auth.users;
CREATE TRIGGER a_banned_email_cannot_hold_an_account
  BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_a_banned_email_cannot_hold_an_account();
