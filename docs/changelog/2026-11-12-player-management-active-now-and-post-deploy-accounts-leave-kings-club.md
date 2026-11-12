# Player Management: Active Now leads, Applicants sits level, PostDeploy accounts leave KINGS CLUB

Dan, 2026-11-12, inside `/hub/club-arena/clubs/kings-club/members`:

> ADJUST "APPLICATIONS" SO ITS EVEN WITH AGENTS. REMOVE ANY AND ALL
> "POSTDEPLOY" ACCOUNTS. AND MAKE IT SO THE "NEWEST PLAYERS FIRST" IS NO
> LONGER THE DEFAULT, IT SHOULD BE ACTIVE NOW (PLAYERS THAT ARE ONLINE) AND IT
> SHOULD PUT THE PLAYERS THAT ARE "ON A TABLE" AT THE TOP, AND JUST ONLINE
> WATCHING, UNDER THE LIVE PLAYERS. FOLLOWED BY LAST ACTIVE IN ORDER.

## Active Now is the default order

`ca_club_members_page` already serves exactly that order under its `activity`
sort: `presence_rank` DESC (2 seated at a live table, 1 online, 0 offline),
then `activity_epoch` DESC (`greatest(last_login, last_seen,
club_members.last_active_at)`), then `user_id` for a stable cursor. Nothing in
the database changed for this.

The client is what changed:

- `DEFAULT_ROSTER_SORT = 'activity'` in `src/lib/rosterWorkspace.ts`, used by
  the default workspace, the URL default (`?sort=` is omitted for it), the
  deep-link fallback and the capability reconciliation in
  `ClubMembersPage.tsx`. The instant-paint roster cache follows the default
  sort, as it followed Newest before.
- The option is labelled **Active Now** and listed first; Newest Players
  First and Oldest Players First remain available choices.
- The `activity` sort is no longer behind `can_view_financials`: a last-active
  order exposes no amount, and a viewer without financial views would
  otherwise have been bounced off the default to Newest.
- A saved workspace (session cache and the `user_page_preferences` account
  row) now carries `version: 3`. A stored workspace below that version adopts
  Active Now once and keeps the operator's search, filter and columns, the
  same way version 1 adopted Newest in October. Later choices persist as
  before.

Tests updated for the new default: `tests/components/playerCommandWorkspace.test.tsx`,
`tests/unit/simpleClubMembers.test.tsx`, `tests/unit/rosterWorkspaceAccount.test.ts`,
`tests/components/playerCommandExportClarity.test.tsx`,
`tests/e2e/css/club-members-containment.spec.ts`.

## Applicants sits level with All and Agents

The Simple view's tab row is two `<button>`s and one `<Link>`. The anchor was
inline, so its 44px `min-height` did not apply and its label sat above the
Agents baseline. All three tabs are now the same `inline-flex` box
(`.members-simple-tabs button, .members-simple-tabs a` in
`ClubMembersPage.css`).

## PostDeploy accounts leave KINGS CLUB, Deep Stack Society and Midway Union

Read from production at 20:50 UTC: 544 reserved certification profiles exist
(`ca-customization-cert-postdeploy-*@example.invalid`); 494 are already
Auth-retired immutable-ledger actors with no membership anywhere, 50 are live.
Eight live ones older than the 162-minute stale floor held 13 active
zero-balance memberships in the three real clubs (KINGS CLUB 6 admin and 2
player, Deep Stack Society 3 admin, Midway Union 3 admin). Those are the rows
Player Management was listing. This is the pattern `20261026050506` settled on
2026-10-26: a certification run whose own cleanup did not complete, with the
operator-only Cert Residue Sweep last run on 2026-11-09 (failed).

`supabase/migrations/20261112205705_post_deploy_test_accounts_leave_kings_club_and_the_union.sql`
(data only, one transaction, no DDL) sends each stale live identity with a
membership in the three clubs through `cleanup_reserved_certification_account`,
departs the zero-balance memberships of any identity the door refuses, refuses
to commit if a reserved identity holds chips in a real club, and asserts no
stale reserved identity remains an active member. Probed in a rolled-back
transaction (CLAUDE.md 11.5, one `DO` block raising at its end): 7 through the
door (one answering `auth_soft_delete_required`, whose memberships the door
departs), 1 refused (`CERTIFICATION_PROTECTED_MEMBERSHIP_HAS_AUTHORITY_OR_CUSTODY`,
it owns an unretired Crest Cert Template club) and departed from 3
memberships, 0 left. Identities younger than the floor are a certification
still inside its own run and remove themselves when it finishes.

Not changed here: the certification fleet still fixtures KINGS CLUB
(`DEFAULT_E2E_CLUB_ID`, `E2E_CLUB_ID` in `post-deploy-e2e.yml` and
`auto-deploy-hetzner.yml`), and the agent-boundary and agent-assignment
certificates assert their reserved identity appears in `ca_club_members_page`
for that club, so the roster cannot hide reserved identities without failing
certification. A reserved identity therefore still appears in Player
Management for the minutes its run lasts. Keeping them out of Dan's real clubs
for good means moving the fleet onto a certification club of its own inside
the Midway Union, which is issue #9830's lane, not this change.
