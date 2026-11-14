# Lobby tab keeps the page it was left on, November 13, 2026

Owner: claude.ai/code session 01UxDLnKy5XXji6eDUB2JHv7. Scope: Club Arena client only (MultiTablePage); no engine, database, financial or maintenance change.

Request (Dan): "+" -> Lobby -> Player Management -> another open tab -> back to the Lobby tab reset to the game lobby; keep it on the exact page it was left on.

Cause: club pages are real routes; the lobby pill borrowed a table URL and rendered the game lobby.

Delivered:
- PR #10770 (squash 0e6c93e75f): `lobbyOffRoutePath` per lobby tab, pure decision `src/utils/lobbyOffRoute.ts`, law `tests/a-lobby-tab-keeps-the-page-it-was-left-on.law.test.ts`. Published run 43551011810.
- PR #10779: held lobby tab hides its mounted game lobby (`visibility: hidden`) so a swipe never drags it into view.

Live signed-in verification, served revision 5b38a8b6a1 (contains 0e6c93e75f), Dan's own Chrome profile (KingFish), observing FLO8 .50/1 (42ad5814) with no seat or buy-in, KINGS CLUB lobby, per-frame DOM recorder:
- Pill tap from table -> Player Management restored, Lobby pill active, zero game-lobby frames. PASS
- Deeper page (Player Record /members/<id>) restored the same way. PASS
- Number key "2" and Tab key -> restored, zero game-lobby frames. PASS
- Swipe -> landed on the page, but the game lobby was dragged in during the swipe. FAIL -> fixed in #10779, re-verify on the build that contains it.
- Back out of the page onto the table -> remembered page cleared; Lobby pill shows the game lobby. PASS
- "+" long-press "Open Lobby" while on Player Management -> game lobby; stays game lobby after switching away and back. PASS
- Separate Lobby tabs: by design only one Lobby tab exists ("ONE LOBBY TAB", MultiTablePage); "Open Lobby" focused the existing tab (pills: FLO8, Lobby). Per-tab storage keyed by tab id, unit-pinned.

Status: #10779 in required checks; remaining step is publish + swipe re-verify.
