# A closed person's tournament name, and a banned network (2026-11-09)

Follow-up to `2026-11-09-a-banned-email-cannot-hold-an-account.md` (#10242).
Owner instruction, 2026-11-09: close the two gaps that record left open. This
file is the task's checkpoint. It names no username, email, address or device.

Policy read: `docs/agent-policy/` version 2.9, checked against the canonical
sources. Nothing about the account closure, the chip return or the diamond
disposition is touched or repeated here.

## Gap 1: a closed person's former name in tournament results

`tournament_players.username` holds the name a player registered under.
Terminal tournament rows are immutable, the column is readable by every client,
results pages print it and four results functions return it.

Delivered in stages, because a read policy needs ACCESS EXCLUSIVE on a table
that is written throughout play:

1. Database, installs from main at merge: `ca_closed_player_labels`,
   `tournament_players_public`, the partial index, and the four results
   functions moved onto the view
   (`20261109235153`). Additive: nothing reads differently until a client asks
   the view.
2. Client: the results reads that print a name read the view.
3. Database, daily maintenance window: a read policy on `tournament_players`
   hides a closed person's rows from ordinary readers, so the REST API cannot
   answer with the recorded name.

Scope decision: "closed person" is a profile whose status is `deleted` and
which is not a horse. Of the 63 closed accounts with tournament rows on
2026-11-09, 62 are retired horses, which are house characters; masking them
would rewrite the public face of about 124,000 past tournaments for no privacy
gain. The rule covers every closed human account, present and future, with no
row rewritten.

## Gap 2: a denied address creating an account with a new mailbox

The Vercel firewall covers `hub-vanguard`. Account creation is a Supabase Auth
request the browser and apps send directly, which Vercel never sees.
`20261109235402` adds the function for Supabase Auth's before-user-created
hook and its closed list. Installing it changes nothing until the hook is
enabled in the project's Auth configuration; enablement, the listed networks
and the live checks are recorded in the pull request that completes this work.

## Laws

- `tests/a-closed-persons-tournament-name-is-not-public.law.test.ts`
- `tests/a-banned-network-cannot-create-an-account.law.test.ts`
