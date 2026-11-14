# tests/the-stale-certification-inventory-skips-retired-profiles.law.test.ts

Dan, 2026-11-14: remove any and all post-deploy test accounts. The law pins that the stale certification inventory lists only reserved post-deploy identities that are neither deleted nor retired, so already-retired profiles no longer push it past its 8-second limit or fill its 21-row page and starve the cleanup of newer stale identities.
