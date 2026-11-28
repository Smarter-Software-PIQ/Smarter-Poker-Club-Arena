# Table polish: one-line hand pill, ice announcements, typed initialisms, ink baseline at zero (2026-11-28)

Follow-up to #12328 and #12350 on the #SmarterDesign poker table.

## 1. Hand Detail's hand-number pill stays on one line

On a 393px phone the pill printed "#30460" on one line and "89" on the next.
Root cause: the painted head in `HandDetailModal.css` pins
`.hdm-console .sc__head .sc__pill` to `width: 26% !important` and
`height: 22px !important` to fit the painted slot. The skin's flex head kept
both, so the pill had about 58px for "#3046089", and the skin's
`overflow-wrap: anywhere` broke it. In the skin the pill now sizes to its
number (`width/height: auto !important`), never wraps, and only ellipsizes if
the head truly cannot hold it. Pinned by a new case in
`tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts` (reproduced as 2
lines with the rule removed; 1 line with it).

## 2. Tournament announcements are ice at their source

`TournamentAnnouncementOverlay.tsx` gave Hand For Hand brass `#d6ad52` and
Final Table and Mystery Bounty gold `#ffd700`; the stylesheet then re-inked
them with a `[style*='#ffd700']` attribute override. The component now carries
the palette tokens (`var(--sd-ice)`, `var(--sd-ice-strong)`), the override is
deleted, and the final-table rules and icon are ice. Every animation, timing
and the announcement behaviour are unchanged.

## 3. check-table-skin-ink baseline cleared to zero

`BASELINE` is `{}` and a unit test pins it.

- UI stylesheets (consoles, popups, drawer, chat, Hand Detail, action
  controls, HUD buttons) were fixed: every `text-transform: uppercase` became
  `none`, and gold, amber, orange and purple ink became ice, silver, white or
  cobalt. That covers the Hand Detail action tags, flags and notes, the
  stale-action note, the Add-On balance, the call-any pre-action strip, the
  rabbit-hunt HUD button, the Run It Twice prompt and panel timers, chat dealer
  and highlight lines, the reaction picker and the floating reaction trail,
  the jackpot widget and its hit overlay, the BBJ celebration labels, and Hand
  Reveal's popup (its face-down placeholder and pay key).
- The authentic Arena table is NOT restyled (Dan, 2026-11-27: "The felt,
  cards, chips, avatars and the blurred room background are the authentic
  Arena table and are NOT restyled"). `SeatSlot.css`, `PotDisplay.css`,
  `CommunityCards.css` (including the board's stage label in
  `CommunityCards.tsx`), `ChatBubble.css` and `BombPotWheel.css` keep their
  exact previous values, and so do the stack-depth tokens in
  `design-tokens.css`. They sit in the script's `ARENA_TABLE_FILES` list,
  exempt from the hue and uppercase rules (never from `:hover`), with the
  reason "authentic Arena table, not restyled (owner order 2026-11-27)".

## 4. titleCaseName keeps initialisms it does not know

"MSP POKER" printed "Msp Poker". In a name typed ALL CAPS, a letters-only
token now stays upper case when it has no vowel (a e i o u y) and 2-5 letters,
or has 2-3 letters and is not a short English word or common first name
(`SHORT_WORDS` in `src/utils/titleCase.ts`). An apostrophe makes a word
("DAN'S"). Lower-case names carry no such signal and mixed-case names print as
typed, exactly as before.

## 5. WebKit run of the table ink spec

Main has no push-triggered CI run (the scheduled CI on `76a1affa9` skips the
CSS Beat jobs). The spec's WebKit run is the CSS Beat general shard 8/10 of
PR #12350's CI run 46138517157 (job 140960016936): 27 of 27 `webkit-footer`
cases passed, 0 retries, 0 flaky.
