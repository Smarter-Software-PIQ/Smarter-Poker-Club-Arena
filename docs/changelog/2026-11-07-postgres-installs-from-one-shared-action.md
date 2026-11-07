# PostgreSQL installs from one shared action, with bounded retries (2026-11-07)

About seventy jobs inlined "Install PostgreSQL 17 from the signed PGDG source
only". Each copy failed on its own when the network blinked. The PGDG key
download failed with curl (55) SSL EOF several times a day, and #9950 moved the
key into the checkout. The apt-get update and install calls against
apt.postgresql.org and the Ubuntu mirror still had no retry. Two horse
workflows ran `apt.postgresql.org.sh`, which downloads the key again.

There is now one copy: `.github/actions/install-postgres-17` (composite action)
and its `install.sh`. All 65 canonical steps use the action. `ci.yml`
accounting, the native smoke export client, the backup engine's export client
and the two horse workflows run `install.sh` directly, with their own package
lists.

Unchanged: apt reads only the signed Ubuntu and PGDG sources, from a private
sourceparts directory. The key is the byte-pinned checkout copy, placed at the
path the PGDG source's `Signed-By` names. No default cluster is created.

Added: `Acquire::Retries=5`. The update now fails when an index cannot be
fetched (`APT::Update::Error-Mode=any`) instead of only warning. Each apt
command gets a bounded retry: 4 attempts, backing off 5s, 10s and 20s.

The pins covering the changed workflows were restamped. Each restamp carries a
`postgresSharedInstaller20261107` audit block, and `ci-accounting-inputs.json`
was regenerated with `qualification-input-projections.py --write`. The cash
manifest's pin carries `postgresSharedInstallerSourceAudit20261107`.
