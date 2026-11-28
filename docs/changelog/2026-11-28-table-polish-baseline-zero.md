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

All 21 frozen files were fixed; `BASELINE` is `{}` and a unit test pins it.

- Every `text-transform: uppercase` in the table, console and Hand Detail
  stylesheets became `none` (the copy is already Title Case, or ALL-CAPS
  literals that read the same). The board's stage label is now "Flop", "Turn",
  "River" from the component instead of `toUpperCase()`.
- Gold, amber, orange and purple UI ink became ice, silver, white or cobalt:
  Hand Detail action tags, flags and notes (now the same inks as the skin
  overrides, also off a console), the pot label and its glows, seat hero,
  in-hand and winner rims, the win sparkle, the raise and discard tags, the
  winning hand name on the seat, the SB badge, kill and BBJ credit badges, the
  marked card pick, the stale-action note, the Add-On balance, the call-any
  pre-action strip, the rabbit-hunt cost, Run It Twice timers, chat dealer and
  highlight, reaction picker, the jackpot backdrop pulse, particle and sheen,
  and Hand Reveal's face-down placeholder and pay key. Stack-depth tokens:
  warning is ice, danger soft red (critical red unchanged).
- New artwork stylesheet `src/components/table/SeatArtwork.css`, exempt in the
  script with a reason: the note colour a player chose for an opponent (data,
  like a purchased theme's swatches) and the winning hole card's rim and halo,
  which match the winning board cards in `CommunityCards.css` (already
  artwork). `.seat__card--winner` in SeatSlot.css paints them through custom
  properties.

Left as they are on purpose: felt, cards, chips, avatars, Bomb Pot art, the
player-purchased controller theme swatches, and the board's winning-hand
banner in `CommunityCards.css` (artwork-exempt and pinned as the reference
banner by `tests/unit/pokerbrosWinnerPresentation.test.ts`). The uncoloured
note post-it stays brass: `tests/the-post-it-marks-a-noted-opponent.law.test.ts`
pins it as the sanctioned default.

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
