# 448655 six-max spectator phone portraits below floor: evidence (PRIMARY, 2026-11-24T16:00Z)

- Production, Post-Deploy E2E "Live-table and engine verification", gate `waitForMobileAvatarGrowth`:
  - run 45378122753 (live client `6c6aaa770`, 10:47Z): `below the approved size: 2:190.0<191.0 3:190.0<191.0 4:190.0<191.0 6:190.0<191.0`
  - run 45410017893 (live client `7f6e30be5`, 14:04Z; store row 448655): `below the approved size: 2:190.0<191.0 3:190.0<191.0 4:190.0<191.0`
  - Floor: `PHONE_AVATAR_MIN_HEIGHT_PX.sixSeatSpectator` = 191 (CLAUDE.md 10.7c).
- Cause: the same subject match as 448565. `opponentAvatarLayout.ts` sets
  `factor = min(target / ownSubject, ceiling)`; an opaque photograph's subject is its whole frame, so
  beside a character-art reference chair every photo chair is scaled down to the character's figure.
  #11907 floored the factor on the nine-seat phone rail only; the six-max phone table kept the shrink.
- Local render (chromium 1243, fixture fonts bypassed locally because the proxy refuses ca-static):
  - new case `fixed mobile avatar artwork: 6-max 2-card spectator photo opponents`
    (character art + 5 photos), without this change: `2:171.0<191.0 ... 6:171.0<191.0` (fails).
  - with this change: passes.
  - all 20 `fixed mobile avatar artwork` + `every top chair stands on the rail` cases: 20/20.
- `npx vitest run` opponentAvatarLayout + 4 avatar laws: 79/79.
