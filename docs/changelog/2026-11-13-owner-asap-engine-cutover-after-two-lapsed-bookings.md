# Owner as-soon-as-possible engine cutover after two lapsed bookings

Two owner-ordered engine windows lapsed without a dispatch. The first certificate was made stale by an ordinary migration installed after its Backup copy. The second target was certified against production's exact schema, and a release-control merge from another lane (#10672) landed four minutes before dispatch, so the certified commit no longer carried main's release controls.

This books the earliest admission a fresh certification can meet, 07:36 to 09:00 UTC (01:36 to 03:00 Chicago), notice 07:15 UTC, and states the release-control hold in the runbook so the next lane reads it where it books. No guard, reserve, runtime strategy or SQL bytes change. Outcomes are recorded in the owning release checkpoint, not claimed here.
