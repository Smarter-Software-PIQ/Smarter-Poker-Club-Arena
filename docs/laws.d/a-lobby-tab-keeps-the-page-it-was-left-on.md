# tests/a-lobby-tab-keeps-the-page-it-was-left-on.law.test.ts

Dan 2026-11-13: a "+" lobby tab that was left on a club page (Player Management, Club Data, any `/clubs/:id/...` route) goes back to that exact page when its pill is selected again, instead of resetting to the game lobby; the page is forgotten only when the tab shows its in-tab lobby again or the player backs out of the page.
