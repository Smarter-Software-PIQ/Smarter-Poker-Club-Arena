# A photo opponent keeps the approved six-max phone size (2026-11-24)

Post-Deploy E2E failed on every six-max release since 10:47Z: watched six-max
tables painted photo opponents at 190.0 layout px against the 191 spectator
floor (CLAUDE.md 10.7c). The cause is the subject match already fixed for the
nine-seat rail in #11907: an opaque photograph beside a character-art chair is
scaled down to the character's painted figure. The floor in
`opponentAvatarLayout.ts` now holds on both phone rings 10.7c sizes (six-max
and nine-seat, 481-640px portrait). No approved number moved.

Regression: `fixed mobile avatar artwork: 6-max 2-card spectator photo
opponents` (171.0 < 191 without the change). Evidence:
`docs/production-alerts/evidence/448655-six-max-spectator-photo-portraits-below-floor/`.
