# O34: The Backup Host Reclaims Its Disk Before Every Certification

Date: 2026-11-26 (Chicago). Lane: release custody.

## Why It Broke

From the 19:00 CST cycle on, three certifications in a row (`8a853e382063`, `1ec2ff9d4df8`, `d88a03fd2e91`) passed both swap rehearsals and were then refused with `tournament_freeze_qualification_failed`. The log tail added by #12165 showed the cause in run `45930467830`: `OSError: [Errno 28] No space left on device`. Every certification builds an engine image (`club-arena-engine-standby:<sha>`, dozens a day) and two qualification images, and keeps a qualification folder; nothing removed any of them, so the Backup host filled. The 19:00 and 22:00 CST cycles kept serving.

## How It Was Fixed

`reclaim_backup_disk` runs first in `cmd_certify` (`server/standby/standby-engine.sh`). It removes:

- engine images it built more than 24 hours ago, never the candidate, and never forced, so an image a container still uses stays;
- every qualification image;
- dangling images and build cache older than 24 hours;
- qualification folders, witness folders and build contexts left behind.

It then reads the smallest free space of Docker's data root and the state folder. Under 12 GiB it refuses at once with `backup_disk_low:<n>GiB` (or `backup_disk_unreadable`), and the rehearsals, crash drill and soak are skipped, so a full disk is a named refusal in minutes instead of an unexplained failure 40 minutes in. Every run logs what it removed and the free space, so the threshold can be re-derived from real numbers.

## What Stops It Returning

`tests/the-backup-host-reclaims-its-disk.law.test.ts`: what is removed and what is kept (the candidate, fresh images, an image in use), the free-space reading including "could not tell", and the wiring at the start of `cmd_certify`.

## Verification

- New law 3 of 3; related Backup laws pass.
- Live proof: the next certification logs `disk: removed ... free ... GiB`.
