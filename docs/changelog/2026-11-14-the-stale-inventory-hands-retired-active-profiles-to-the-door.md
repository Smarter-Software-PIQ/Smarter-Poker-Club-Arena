# The stale inventory hands retired, still-active profiles to the door (2026-11-14)

Before `20261114163238`, the cleanup door retired a test identity's Auth record but left its profile active. Since then, the door marks a retired identity's profile deleted, which also takes it out of every membership. But identities retired before that change still have active profiles. The stale inventory skipped them because their Auth record was already retired, so nothing would ever finish them. At 19:26 UTC, six profiles older than the 162-minute floor were in this state: PostDeployf5601 and five crest_cert identities.

`20261114192610` makes the inventory list every reserved post-deploy profile that is not deleted, whether retired or not. The door marks a retired one deleted, and a deleted one is never listed again. Per-profile retirement checks are gone, so the call is faster: 10 candidates in 0.03 s.

Pinned by `tests/the-stale-inventory-hands-retired-active-profiles-to-the-door.law.test.ts`.
