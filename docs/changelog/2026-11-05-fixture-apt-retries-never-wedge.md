# Fixture Package Retries Never Wedge The Runner

The first streamed fixture build (PR #9512, 2026-11-05 03:57Z) showed why every native fixture attempt since 2026-11-04 died or hung. After the PostgreSQL packages installed, a download from `snapshot.debian.org/archive/debian-security` failed and apt's delayed retry entered its own loop, printing `Tried to start delayed item ... openssl ... but failed` about 6,900 times in one second and never finishing. That flood is what lost or wedged the hosted runners.

The fixture's apt transport now retries immediately (`Acquire::Retries::Delay "false"`) and allows five attempts instead of three. The Debian snapshot, its signatures, pinned package versions and every other fixture input are unchanged.
