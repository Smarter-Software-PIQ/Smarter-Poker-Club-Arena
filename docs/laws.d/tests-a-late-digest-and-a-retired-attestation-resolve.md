# tests/a-late-digest-and-a-retired-attestation-resolve.law.test.ts

The newest rewrite of the chip-integrity attestation supersede (fn_try_record_owner_notification) must resolve older firing attestation copies in both 'owner-operational-notifications' and the retired 'owner-operational-push' source, and a sp_daily_digest_runs row reaching 'sent' must resolve that day's sp-digest-missing alert (2026-11-24). After #11893, 10 retired-source attestation copies and 2 not-delivered rows for digests delivered late still fired with no path to resolve; the law fails on the #11893 supersede.
