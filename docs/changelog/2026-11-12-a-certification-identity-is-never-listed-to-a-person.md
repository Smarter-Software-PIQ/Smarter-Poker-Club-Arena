# A certification identity is never listed to a person

**Date:** 2026-11-12
**Owner ask:** Dan, 2026-10-26 and 2026-11-12: "REMOVE ANY AND ALL 'POSTDEPLOY'
ACCOUNTS" from Player Management (`/hub/club-arena/clubs/kings-club/members`).
**Migration:** `20261112231056_a_certification_identity_is_never_listed_to_a_person.sql`
**Law:** `tests/a-certification-identity-is-never-listed-to-a-person.law.test.ts`

## Why they kept coming back

The accounts were settled out of KINGS CLUB by migration on 2026-10-26 and
again by `20261112205705` today. Neither could hold, because the certification
fleet fixtures KINGS CLUB (`E2E_CLUB_ID` in `post-deploy-e2e.yml` and
`auto-deploy-hetzner.yml`, `DEFAULT_E2E_CLUB_ID` in
`production-e2e-account.mjs`): each certificate joins a reserved identity
(`ca-customization-cert-postdeploy-*@example.invalid`, legacy
`club-create-cert-*@smarter-poker.invalid`) to the club as a player or admin
for the minutes it runs, and the agent-boundary and agent-assignment
certificates then read `ca_club_members_page` AS that identity and assert it
is listed. A client filter would hide them from Dan and break the certificates;
moving the fleet off KINGS CLUB is a multi-day programme (forty-odd specs,
`qualify-agent-boundary.mjs` asserts Kings Club only, fixtures need live
games) and would still leave the next fixture club with the same problem.

## The rule, at the source

`ca_is_reserved_certification_identity(uuid)` is true for an `auth.users` row
whose email is in the certification namespace. `ca_viewer_sees_certification_identities()`
is true for the service role and for a reserved identity reading as itself.
The roster's base CTE (`ca_club_roster_rows`, which `ca_club_members_page` and
`ca_club_members_export` read through) and the roster summary counts
(`ca_club_members_summary`) now carry

```sql
AND (v_sees_certification OR NOT public.ca_is_reserved_certification_identity(cm.user_id))
```

so a certificate still sees everything it asserts, and a person never sees a
certification robot in any club. Both readers are patched from their live
definition against a recorded md5 preimage; the migration aborts rather than
overwrite a reader that moved.

This is not a horse filter (CLAUDE.md 10.5). Horses are players and are never
named; the predicate names only the fleet's own reserved identities, which
are not players of anybody's club.

## One door for the Live Now strip

`ca_club_live_seats(p_club_id)` returns every open seat of the club's tables
(waiting or running, not deleted) with the table name, stakes, tournament id,
and the player's alias, username and avatar, under the roster's viewer rule
(approved member, platform admin, union overseer or service role) and the
same reserved-identity rule. Player Management's Live Now strip and the row
table chips read it instead of two PostgREST joins on `table_seats`, so the
strip is served by the same authority as the roster and cannot show an
identity the roster hides.

## Verification

- Law suite and migration-structure tests green locally.
- After merge: `apply-merged-migration` run for the file; `@live-proof` asserts
  `ca_club_live_seats` exists and both patched readers contain the predicate.
- Live: `ca_club_members_page` and `ca_club_members_summary` as a person
  return no `*cert*@*.invalid` identity; as the service role they still do.
