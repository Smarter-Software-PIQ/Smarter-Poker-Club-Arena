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

## Stage record (2026-11-10 UTC)

Gap 1:

- `20261109235153` merged in #10253. Its dispatch fell in the applier's
  break-window budget (a CONCURRENTLY preamble needs 12 minutes before :50), so
  it is dispatched by hand after :03, as the dispatcher's summary directs.
- Found before any client read the view: a function named in a view runs with
  the reader's privileges, and anon may not execute `fn_is_platform_admin`, so
  a signed-out read of `username` through the view would have been refused.
  `20261110004344` replaces the view with the staff test written as a read of
  `profiles`. Forward migration; the first file is not edited.
- `20261110003726` is the read policy, queued for the daily maintenance
  window: one RESTRICTIVE policy for `authenticated` (staff exempt) and one for
  `anon` that names no function anon cannot call.
- Client: `readTournamentStandings` and the archive's Biggest Hits read ask
  `tournament_players_public`. Those two reads serve the results archive, the
  tournament detail entries and the table standings.
- Until the policy installs, the REST API still answers a direct read of the
  table with the recorded name.

Gap 2:

- `20261109235402` installed from main (schema_migrations row read back). The
  list holds the four addresses; each is refused by the function, a neighbour
  address and an IPv6 address are allowed.
- The hook was enabled in the project's Auth configuration at 00:43:52 UTC
  and read back.
- Live, from an origin the task controls, through the real Auth endpoint
  (`/auth/v1/otp`, which the browser calls on the Supabase host directly and
  which never passes Vercel): unlisted, the request passed the hook; with a
  temporary rule for that origin it was refused 403 with the hook's message;
  with the rule removed it passed again. Every attempt used a made-up address
  that was on the email ban list for the test, so no account was created. The
  temporary rule and the temporary email entry were removed and read back.
  Ordinary signups continued after enablement.
- The address Auth acts on is the one Supabase's own edge observed for the
  connection. No forwarding header sent by a client was treated as proof.

What an address rule cannot do is unchanged: a different network is a
different request.

## Laws

- `tests/a-closed-persons-tournament-name-is-not-public.law.test.ts`
- `tests/a-banned-network-cannot-create-an-account.law.test.ts`

## Later stages (2026-11-10 UTC)

Gap 1:

- `20261110051146` (#10315) installed: both views declare
  `security_invoker = false`. The platform makes a new public view
  caller-rights by default, and as caller-rights views a signed-out read was
  refused ("permission denied for table profiles").
- Client (#10272, `cc77b7d9`) published by `publish-club-arena.yml` run 42836150644. Both `build-info.json` endpoints report it, and the served
  `readTournamentStandings` and `TournamentResultsPage` chunks read
  `tournament_players_public`.
- Live, as a signed-out client over the REST API with the publishable key the
  served app ships: the view returns all four of the closed person's rows with
  the closed-profile label and their placements and prizes; in a 193-row
  control tournament 192 names are unchanged and one is the label. The table
  itself still returned the recorded name until the read policy installs.
- Install blocker: the daily window skipped `20261110003726` on November 10.
  The scheduled preparation events arrived about two hours late (11:34 and
  12:50 UTC), so no daily preparation was admitted, and the 09:50 UTC owner
  engine dispatch does not run queued window migrations. The owner authorized
  one database-only break the same day (window
  `2026-11-10-closed-person-name-policy-db`).
- Boundary check of the owner-rights views: `tournament_players_public` has
  exactly the table's columns. The table's only other read policy is
  `USING (true)`, so the view bypasses no membership rule, and it masks only
  `username`. `ca_closed_player_labels`, which ordinary readers must be able
  to select for the read policy, listed every closed profile id (1,000 per
  REST page of 2,664). `20261110152707` lists a closed person only where a
  tournament result names them, which is all either reader asks.

Gap 2, signup entry points:

- Supabase Auth runs the hook on signup, OTP and magic link, OAuth, SAML,
  web3, anonymous, invite and generate_link. It does not run it on
  `POST /admin/users` (GoTrue `adminUserCreate`, supabase/auth master
  `1357a5b90faa`). The email gate is a trigger on `auth.users` and covers every
  path, including the admin API.
- Club Commander's public registration creates accounts through the admin
  API. `20261110152816` lets the service role ask the hook function, and that
  route asks it with the address Vercel's edge observed before it creates
  anything.
- Every other admin-API account creation is server-only, authorized by the
  service role key, and creates fixture, probe and house accounts.
  invite and generate_link run the hook with the calling server's address, not
  a player's.
