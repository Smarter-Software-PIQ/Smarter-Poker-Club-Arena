# tests/a-banned-network-cannot-create-an-account.law.test.ts

On 2026-11-09 the owner ordered a removed player's network addresses blocked
from creating another account. The Vercel firewall denies them on the World
Hub, but an account is created by Supabase Auth, which browsers and the apps
call directly, so a denied address with a different mailbox met no rule.
Supabase Auth's before-user-created hook gives its function the address Auth
observed for the request before the `auth.users` row exists.
`fn_a_banned_network_cannot_create_an_account` refuses an address inside a
network listed in `public.banned_signup_networks` with the documented error
object and answers every other request, including one whose address is missing
or unreadable, with an empty object. It runs for every signup on the platform,
so this law holds it to never raising and to allowing what it cannot read. Only
`supabase_auth_admin` may execute it; the list has row level security, no
policy and no grant. The hook is in force only while the project's Auth
configuration names this function, which is read back at enablement and is not
something a source test can see. A different address is a different request:
this stops a listed network, it does not recognise a person.
