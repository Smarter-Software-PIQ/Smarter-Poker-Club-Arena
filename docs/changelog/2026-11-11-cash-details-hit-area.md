# Cash lobby Details stays inside its own row

Chromium's compact cash Details flex child could extend outside its row and be
covered by another game's heading. Reuse the existing tournament Details row
hit area for cash games, keeping Favorite above it and preserving artwork.
The existing mobile lobby harness reproduced a 288px width mismatch before the
fix and passes the contained rectangle, ordinary Details click and separate
Favorite click afterward.
