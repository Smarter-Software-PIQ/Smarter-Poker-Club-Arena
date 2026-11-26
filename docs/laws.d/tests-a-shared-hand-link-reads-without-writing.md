# tests/a-shared-hand-link-reads-without-writing.law.test.ts

A shared hand link is opened through a door a caller with no account can run,
so that door only reads, and nothing a caller with no account can run writes.

Migration 20261107021555 granted `fn_ca_shared_hand_open` to anon so a
signed-out visitor can open a shared hand, and let the same SECURITY DEFINER
body bump the view count on every open. The live definer-exposure audit refuses
an anon-executable definer writer with no allowlist, and it failed every run
from 2026-11-07 to 2026-11-26 on that one function (issue #9828). No build-time
rule saw it, because rules 1 and 2 of `check-definer-authorization.mjs` clear
any body that mentions `auth.uid()`, and this one mentioned it only to skip the
sender's own views. For a logged-out caller `auth.uid()` is NULL, so the body
wrote for anybody.

Migration 20261126054024 splits the read from the write. The reader keeps its
signature and answers, is STABLE and writes nothing; `fn_ca_shared_hand_count_view`
is the only writer and only authenticated and service_role can execute it. The
client counts a signed-in opener's view through that writer; a signed-out
open is counted by World Hub's server route with the service role (see
`tests/a-signed-out-shared-hand-open-is-counted.law.test.ts`).

The law pins the migration's shape, the client's two calls, and the lists that
record the reader as deliberate public surface. It also pins rule 5 of the gate,
which now asks the live audit's question 2 before the merge in the same words:
SECURITY DEFINER, writes, and anon or PUBLIC can execute it, refused whatever
the body consults and with no allowlist. 20261107021555 is refused by its own
text. A replace of a function main already declares keeps its grants, so for
those only an explicit GRANT to anon or PUBLIC in the branch opens it.
