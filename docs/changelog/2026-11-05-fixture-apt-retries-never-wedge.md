# Fixture Package Retries Never Wedge The Runner

The first streamed fixture build (PR #9512, 2026-11-05 03:57Z) showed why every native fixture attempt since 2026-11-04 died or hung. After the PostgreSQL packages installed, a download from `snapshot.debian.org/archive/debian-security` failed and apt's delayed retry entered its own loop, printing `Tried to start delayed item ... openssl ... but failed` about 6,900 times in one second and never finishing. That flood is what lost or wedged the hosted runners.

The fixture's apt transport now retries immediately (`Acquire::Retries::Delay "false"`) and allows five attempts instead of three. The Debian snapshot, its signatures, pinned package versions and every other fixture input are unchanged.

## The Snapshot Archive Is Replaced

With immediate retries the next run (job 127058764329) no longer wedged: it failed cleanly after six minutes because `snapshot.debian.org` answered `504 Gateway Timeout` for `procps_4.0.4-9_amd64.deb` on every attempt, after serving earlier packages at about ten seconds each. The fixture now installs from the signed official archives `deb.debian.org/debian` and `deb.debian.org/debian-security` (`trixie`, `trixie-security`). Every pinned PostgreSQL package (17.11-0+deb13u1, pgvector 0.8.0-1, wal2json 2.6-2+b1) was verified in those indexes on 2026-11-05 and stays pinned; other packages follow Debian stable updates. Release expiry checking is back on.
