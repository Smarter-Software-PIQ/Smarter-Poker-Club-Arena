# tests/mobile-avatars-never-ratchet-smaller.law.test.ts

Phone table portraits (six-max and full ring, cash and tournament) are drawn at the approved sizes in `src/components/table/mobileAvatarSize.ts`, which SeatSlot.css must match and which may never be lowered; no size is recorded on the device (the retired downward-only `sp-mobile-avatar-size*` keys are deleted on load), the nine-seat rail is recomputed from its base and grows back, and the locked size never depends on wagers, the puck's chair or a tabled hand at the moment the table opened (Dan 2026-11-18).
