# tests/the-stale-inventory-hands-retired-active-profiles-to-the-door.law.test.ts

Dan, 2026-11-14: remove any and all post-deploy test accounts. The law pins that the stale certification inventory lists every reserved post-deploy profile that is not deleted, including identities whose Auth record is already retired, so the cleanup door can finish them by marking the profile deleted.
