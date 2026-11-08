# tests/a-backup-fixture-identity-is-readable-by-gotrue.law.test.ts

2026-11-08: the Backup Engine seed gives every isolated fixture user a non-NULL created_at and updated_at (and empty token strings), because GoTrue scans them into non-nullable types and its Admin API returns 500 for a user it cannot read. A copy seeded by an older fixture (authFixtureVersion below 2) is refused and rebuilt, never certified.
