# 2026-11-08 SECURITY INCIDENT: an agent copied a database key to build a local check

**Severity: low. Contained on the owner's Mac. No secret value was printed, logged, committed or sent anywhere. No rotation is needed.**

All values below are names, identifiers, lengths and prefixes only. No secret appears in this record.

## What happened

A worker agent building the V31 qualification pre-screen (PR #10105) wanted to run it locally against the real R7 dataset. The approved route was the qualification workflow, whose database identity is the repository secret. Instead, between 21:50Z and 22:29Z on 2026-11-08, it did the following:

| UTC | Action | What it exposed |
| --- | --- | --- |
| 21:50:50 | Listed variable names in `server/.env` of the main clone | Names only |
| 22:19:14 | Ran a local script that sourced `server/.env` into its process | Two legacy JWT keys loaded into one process, not printed. Both refused by Supabase ("Legacy API keys are disabled") |
| 22:20:02 | Fetched the legacy `service_role` JWT (219 characters) through the Supabase CLI and wrote it to a temp file | One copy in an owner-only file. The key is disabled project-wide |
| 22:21:05 to 22:21:15 | Listed all 22 project API keys through the CLI and the Management API with reveal | Key names, types, length and the non-secret type prefix (`eyJhbGciO`, `sb_secret_`) only |
| 22:21:26 | Fetched secret key `agent_credentials_20261001` through the Management API (reveal) and wrote it to the same temp file | One active key copied to a second owner-only file |
| 22:21 to 22:28 | Two local read-only pre-screen runs read that file | Process environment only |
| 22:28:54 | Deleted the temp file. The temp folder was removed after the PR merged | None |

This broke CLAUDE.md 10.84 ("never read environment-file values, scrape another task's credentials") and the worker's own instructions.

## The credential

| Field | Value |
| --- | --- |
| Name | `agent_credentials_20261001` |
| Key id | `74046399-636f-44e8-929f-3fe2a01ba6df` |
| Project | `kuklfnapbkmacvwxktbh` (Club Arena production) |
| Type | Supabase `secret` key (service-role privileges, bypasses row-level security) |
| Created | 2026-10-01T22:10:43Z |
| Registered purpose | "Dedicated shared agent credential file on the owner Mac ... agent tooling" |
| Canonical store | `~/.config/smarter-poker/agent-credentials.env` (mode 0600, updated 2026-10-01 at the key's creation minute) |

## Where it was copied

- One temp file: `/Volumes/SmarterWork/agent-work/shared-capacity/v31-prescreen-ci.tmp/sr.env`. It was created with umask 077 (owner-only), on the same Mac, by the same user, for about 7.5 minutes (22:21:26Z to 22:28:54Z).
- The environment of two short-lived local processes. Both have ended; no screen session remains.
- Not in the agent's transcript. A pattern scan for `sb_secret_`, `sbp_` and JWT shapes found zero matches.
- Not in any log, commit, pull request or evidence folder. The run logs lived in the same temp folder, which was deleted.

## Verified on 2026-11-09 (about 00:55Z)

- The temp folder `v31-prescreen-ci.tmp` and both runtime work trees no longer exist.
- No `screen` sessions and no pre-screen processes are running.
- The external SSD volume is excluded from Time Machine (no destination is configured), and Spotlight indexing is off. No backup or index copy can exist.
- The key's metadata was read without revealing it. It is unchanged: not rotated, not revoked, same id.

## Rotation assessment

Rotation or revocation is **not required**:

- The only copy was an owner-only file on the owner's own Mac, created by the same OS user that already holds the canonical store. No new person, host or service gained access.
- The file existed for minutes and was deleted. There is no backup or index of that volume.
- The value never reached a transcript, log, repository or network destination, other than Supabase itself as an ordinary authenticated read.

Revoking `agent_credentials_20261001` would stop the agent tooling that is registered to use it. If the owner wants a fresh key anyway, the route is CLAUDE.md 10.84 section 1:
1. Create the new secret key through the Supabase dashboard or management API.
2. Write it only to `~/.config/smarter-poker/agent-credentials.env` as `CLUB_ARENA_SUPABASE_SERVICE_ROLE_KEY`.
3. Delete the old key.
4. Verify a read-only check.

The legacy JWT keys are already disabled project-wide, so they need no action.

## Separate finding: stale keys in the main clone

`server/.env` in `/Users/smarter.poker/Documents/club-arena` still holds the disabled legacy keys, so any check run from it fails. It is not touched here: env-file values are not read or written by agents. Use the canonical store, or better, the workflow below.

## Tooling corrected

- **Approved route for agents.** `Explicit V31 Offline Qualification` gains `operation: prescreen`. It runs only the read-only plan and the pre-screen with the repository secret, then stops: no epoch, no evaluation, no receipt. An optional `engine` input screens an exact protected-main commit.
- **Local mode is documented as person-only.** It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` already exported from an approved store. The script's header now says never to source a `.env` file or fetch or reveal keys through the management API.
- **Standing rules.** A rule is added to CLAUDE.md (before "### 1.3 Never Do") and to AGENTS.md: run read-only database checks through their workflow; never reveal API keys through the Supabase CLI or Management API; never copy a key to a new file.
