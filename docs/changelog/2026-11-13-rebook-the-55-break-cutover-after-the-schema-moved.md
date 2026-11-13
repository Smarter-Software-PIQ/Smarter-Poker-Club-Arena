# Rebook the :55 break cutover after the schema moved

The first owner-ordered window (`2026-11-13-owner-now-55-break-engine-0338z`) lapses unused. Its target was certified at 03:15 UTC, but an ordinary migration was installed in production at 03:05 UTC, after the certified Backup copy was restored, so the copy no longer equals production and the selector must refuse it. A fresh certification takes about 65 minutes and could not finish before that window's fixed expiry.

This books the same owner order at the next :55 break: 05:38 to 06:00 UTC (23:38 to midnight Chicago), notice 05:15 UTC. No guard, reserve, runtime strategy or SQL bytes change. Outcomes are recorded in the owning release checkpoint, not claimed here.
