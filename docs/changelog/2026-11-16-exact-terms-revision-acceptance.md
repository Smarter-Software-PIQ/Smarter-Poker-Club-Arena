# Exact Club Arena Terms Revision Acceptance

A previous acceptance timestamp does not identify the words a player reviewed.
The nullable `profiles.club_arena_tos_revision` records the exact reviewed
revision alongside the existing timestamp. Existing stamps remain historical;
no acceptance is backfilled or silently promoted.

The private service-role RPC validates the exact current revision, locks only the
requested profile, and atomically records both fields. Matching finite receipts
replay with their original timestamp, including concurrent first acceptance.
Authenticated users receive column read access under existing profile RLS, with
no acceptance-write privilege. Browser and invalid service requests are refused.

This is a schema-first delivery with no financial migrations mixed into it.
Install the daily-maintenance schema/RPC before publishing the World Hub writer
and the CA reader that require the new revision. The isolated PostgreSQL 17
proof runs in the existing required account-native CI shard and retains its
source hashes and results. Publication and installed/live verification remain
separate from source qualification.
