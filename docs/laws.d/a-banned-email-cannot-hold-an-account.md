# tests/a-banned-email-cannot-hold-an-account.law.test.ts

On 2026-11-09 the owner removed a player from the platform and ordered that
the same mailbox never open another account. Closing an account removes the
login, but nothing stopped the same address signing up again by email, by a
provider login or by changing another account's email to it. So a mailbox
listed in `public.banned_signup_emails` cannot become the email of any
`auth.users` row: a BEFORE INSERT OR UPDATE OF email trigger on `auth.users`
refuses it with `SIGNUP_BANNED`, whichever door the request came through.
`fn_signup_email_key` gives one mailbox one key (lower case, +tag removed,
Gmail dots removed, googlemail.com folded into gmail.com), so the obvious
respellings of a banned address are the same ban. The list has row level
security, no policy and no grant to anon or authenticated; only the service
role and the database owner read or write it. This law holds the trigger to
both events, holds the gate to raising rather than swallowing its refusal
(the opposite of `handle_new_user`, which must never lose a signup), and fails
if a later migration opens the list with a policy or a grant. It does not
claim to recognise a person: a different mailbox is a different key.
