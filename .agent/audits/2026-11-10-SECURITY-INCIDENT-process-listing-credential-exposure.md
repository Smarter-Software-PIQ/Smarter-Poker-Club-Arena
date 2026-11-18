# 2026-11-10 SECURITY INCIDENT: a process listing printed other processes' credentials into an agent transcript

**Status (2026-11-11 reconciliation): OPEN. Neither confirmed nor disproved. See "Reconciliation" at the end; the next action is the account holder's.**

**Severity: medium until rotation is decided. Values reached an agent session transcript (Anthropic session storage for this account). No value reached the repository, a pull request, a comment, a log file or any other destination this record could find. The exact credential types cannot be recovered and are recorded as unknown.**

No secret appears in this record: names, counts and pattern classes only.

## What happened

| UTC (2026-11-10)     | Action                                                                                                                                                                                    | Exposure                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| about 23:00 to 23:50 | A worker agent (Lightning thin-pool lane, PR #10399) ran `pgrep -fl` on the owner's Mac through the host terminal while checking whether a process was running.                           | `pgrep -fl` prints each matching process's full command line. Some processes running at that moment carried credentials in their arguments, and those values were printed into the worker's tool output, which is part of its session transcript. |
| same session         | The worker noticed, did not copy or use the values, and switched to commands that do not print arguments. It reported the exposure in its final report without listing which credentials. | None further.                                                                                                                                                                                                                                     |

This broke CLAUDE.md 10.84 ("never print secrets") in effect, though the command was a process check, not a credential read.

## Scope

- **Where the values went:** the worker's own session transcript only (Anthropic session storage for the owner's account). The coordinating session never saw the values: it received only the worker's final report, which named no credential.
- **Credential types: unknown.** The worker's session can no longer be resumed from the coordinating session (its saved settings are gone), so the exact process lines cannot be re-read, and re-running the listing would expose them again. The possible classes are the credentials agent tooling and long-running tools on that Mac pass as arguments at that time: GitHub tokens, Supabase keys, Vercel tokens, database URLs with passwords, model API keys.
- **Processes now:** at 2026-11-11 00:47Z a redacted scan of every process's arguments (prints pid, executable name and pattern class only; patterns for GitHub PAT/OAuth, Supabase secret and management keys, JWT, Vercel, Anthropic, database URLs with passwords, and NAME=value pairs for \*TOKEN/KEY/SECRET/PASSWORD/PAT/URL) found no process carrying a credential in its arguments. The only matches were the scan itself, whose source contains the pattern text. So the exposed lines came from processes that have since ended.
- **What the worker wrote:** zero pattern matches in its squash commit `1c06524d`, PR #10399 body and comments, its #10063 comment 6782588985 and its changelog `docs/changelog/2026-11-10-lightning-a-thin-pool-deals-four-handed.md`.

## Rotation assessment

Because the values reached a transcript and the types cannot be determined, every credential that agent tooling on the owner's Mac passed as a process argument between 23:00Z and 23:50Z must be treated as exposed. This record cannot name them, so the owner decides between:

1. **Rotate the agent credentials on the Mac** (conservative). Each rotation and its impact:
   - GitHub fine-grained PAT in `~/.env` and `~/Documents/club-arena/.env` (`GITHUB_TOKEN`, `GITHUB_PAT_FINE_GRAINED`): agents' pushes and API reads through the token fail until the new token is written to both files. The separate `gh` login is unaffected unless it was the exposed one.
   - Supabase agent secret key `agent_credentials_20261001` in `~/.config/smarter-poker/agent-credentials.env`: agent tooling that reads it fails until replaced (steps in the 2026-11-08 record, "Rotation assessment").
   - Vercel token used by agent tooling: Vercel MCP/CLI calls fail until replaced.
   - Model API keys used by local agent tools, if any: those tools stop until replaced.
     Production services (engine on Hetzner, publisher, database lane) use their own stored credentials (Vault, GitHub repository secrets, engine host) and are not affected by rotating the Mac's agent credentials.
2. **Accept the risk** with the reasoning that the transcript is private to the owner's account; this record then stays open as accepted, not closed.

Rotation requires writing to secret stores, which agent sessions here are not permitted to do; it is the owner's action.

## Prevention

- CLAUDE.md (before "### 1.3 Never Do") gains a standing rule: never print another process's command line or environment; check a process with `pgrep -x <name>` or `ps -axo pid=,comm=` only.
- Every worker launched by the Lightning lane after 2026-11-11 00:20Z carries the same instruction in its brief.

## Investigation, 2026-11-11 (owner authorized at 03:19 Chicago)

Goal: identify which credentials were actually exposed, from redacted metadata only, and rotate only confirmed ones. Every check below printed names, counts, timestamps or pattern classes; no value was printed, hashed or quoted.

**What `pgrep -fl` can show on this Mac.** macOS `pgrep -f -l` prints each matching process's argument list, not its environment. So only credentials carried in process ARGUMENTS were exposed; anything passed through the environment was not.

**Long-running processes are not the source.**

- Every MCP server on this Mac (`~/.claude.json`, Claude desktop `claude_desktop_config.json`) starts through `~/.local/bin/with-keychain-credentials`, `~/.local/bin/supabase-mcp-keychain` or the counselors server, and each passes the GitHub and Supabase tokens through exported environment variables (`exec "$@"` / `execFile` with `env`), never as arguments. No configured server has a credential-shaped argument.
- The 00:47Z redacted scan of every running process found no credential in any argument list.
- `scripts/agent-push.sh` authenticates git through `credential.helper=!gh auth git-credential` (stdin), so no token is on its command line.

**Transient agent commands in the window (22:50 to 23:59Z).**

- Local Codex session logs (14 files active in the window) record no command with a credential-bearing shape (psql with a URL variable, `PGPASSWORD`, curl with an Authorization header, `http.extraheader`). Four lines matched a loose token pattern; the strict check found zero real credentials in each (opaque reasoning blobs), and none is in the window.
- The Claude desktop logs (`mcp-server-counselors.log`, `mcp.log`, `remote-control.log`) contain no `pgrep` call and no credential pattern at all. Commands that cloud sessions send through the remote-device terminal are not logged on this Mac, so other cloud sessions' commands in the window, and the worker's own `pgrep` output, cannot be reconstructed here.

**Conclusion.** No credential can be confirmed as exposed. What remains possible is a credential embedded in the arguments of a short-lived process started by a cloud agent session during the window (for example `psql` given a database URL, or curl given an expanded token), which ended before 00:47Z. Under the owner's instruction (rotate confirmed exposures only, never unrelated credentials), **nothing is rotated.** If the worker's transcript is ever recovered, it decides: any value it shows is rotated through its provider, consumers updated and the old value revoked.

**Root fix (this change).** Two repository scripts meant to run on the Mac put a database URL with its password on `psql`'s command line: `scripts/dev/export-applied-migrations.sh` and `scripts/verification-harness/run-all.sh`. Both now call `scripts/lib/pg-env-from-url.sh`, which reads the URL from the environment, splits it into libpq's `PG*` environment variables (password included) and runs psql with no URL argument; the parser reads the URL from the environment, not argv. `tests/unit/aDatabaseUrlNeverRidesOnArgv.test.ts` pins both. CI-only scripts that pass a local, password-free test URL are unchanged.

## Reconciliation, 2026-11-11 (the two accounts disagree; this record does not close the incident)

The two earlier sections say different things, and neither settles the case.

**What was observed.** The thin-pool worker reported, in its own final report, that output from its `pgrep -fl` on the owner's Mac showed other processes' environments, including credentials. It said it did not copy or use them and switched to commands that print no arguments. It named no credential and no type.

**What #10479 established, and what it does not.** On macOS, `pgrep -fl` prints each process's argument list, not its environment. #10479 searched every record it could reach and found no argument-borne credential in retained evidence. That shows the worker's description of the output as "environments" was probably inaccurate. It does not show that the output held no credential: an argument list can carry one, and the output itself was not examined.

**Affected credential types: unknown.** The most plausible type is a database connection credential (a Postgres URL with its password), because the only argument-borne credential paths this investigation found were two repository psql scripts that passed such a URL on the command line. Those are fixed in #10479. This is unconfirmed: no record shows such a script running in the window.

**Where the output is retained.** It is in that worker's session transcript, in this Claude account's session storage, which the account holder and the provider can access. This record, the coordinating session, the repository, pull requests, comments and logs hold no copy, and none was made elsewhere.

**What remains unknown.** It is unknown whether the output contained any credential, which processes it listed, which credential types appeared, and whether any value has been used since.

**Moving secrets is not remediation.** Moving credentials from repository scope to environments, or from arguments to environment variables (#10479), reduces future exposure. It neither rotates nor revokes any value that may already have been exposed.

**Next action (account holder).** Open the worker's transcript (the agent titled "Thin-pool table size policy" in this account's session history), find its `pgrep -fl` output, and report only the credential TYPES it shows (for example "a Postgres URL with password", "a GitHub token"), never the values. Each confirmed credential is then rotated, its consumers updated to the new value, and the old value revoked, with each step recorded here. If the transcript shows no credential, record that here and close the incident on that evidence. Absence of retained evidence elsewhere is not grounds to close it.
