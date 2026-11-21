# server/src/engine/horseDecision/aSwitchListIsNeverStale.law.test.ts

A Horse Option Switch List Migration Is Never Stale: Every List Migration After The Anchor Names The One Immediately Before It, A Branch May Not Add A List Migration Older Than Or Without origin/main's Newest, And Each Follow-Up Stamps Its Version Into fn_ca_horse_option_switch_states And Refuses To Install Over A Newer One, So A Lane Branched Before Another Lane's List Merged Can Never Quietly Put Back Older Allowed States (2026-11-20, After PR #11545 Nearly Re-Held huBbDefendsUnreadToPrice).
