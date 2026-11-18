# The phone table's bottom row, hero seat, action pill and notch

**2026-11-11.** Dan, from his phone, three items for the live table:

- **3.** The action buttons are far too small. Double them, growing upward
  until their top edge sits just under the bottom-center seat box (its name
  plate and the hand label under it, "10 High"). The Previous Hand button moves
  up with them. The hero's avatar is always as large as every other avatar.
- **5.** The action pill shows the hero's cards only. The hero's own action
  (Check, Call, Fold, Bet, Raise, All In) shows on the seat, never in the pill.
- **6.** Nothing is ever cut off at the top: notch, Dynamic Island, an installed
  app's status bar. Locked so it cannot regress.

## The cause the three share

Since 2026-10-25 a portrait phone lays the table out at the desktop width
(`PHONE_TABLE_LAYOUT_WIDTH_PX`, 600 CSS px) and scales it down
(`useTableEnvironment`). Two consequences were never followed through:

1. **Every `@media (max-width: 480px)` rule is dead at a table.** The phone's
   layout viewport is 600px wide there. That includes the 2026-11-09 doubling
   of the action row (`--sp-action-btn-h: 96px`) and the installed-app status
   bar floor in `TableTabBar.css`. Measured before this change: every phone drew
   the desktop curve's 51.8px button.
2. **`env(safe-area-inset-*)` is not scaled with the page.** Measured in
   Chromium with a 59px Dynamic Island inset (CDP
   `Emulation.setSafeAreaInsetsOverride`): 59 at scale 1, still 59 at the
   table's 0.65. The tab bar paid 38 device px of a 59px band, and its controls
   sat at 46.9 to 53.8 device px, under the island. The home indicator under
   the action row was underpaid the same way.

## What changed

- **One query names the phone table**:
  `@media (max-device-width: 480px) and (min-width: 481px) and (orientation: portrait)`.
  A portrait phone (the same 480px bound the hook applies to `screen.width`)
  whose layout viewport is wider than 480px, which happens only while the
  table has switched it to the desktop width. Every other phone route keeps its
  own width and its own <=480px rules.
- **Bottom row** (`ActionPanel.css`): `--sp-action-btn-h: 104px` (2 x 52) in
  that query. `--sp-bottom-row-h`, `--sp-action-reserve`, `--sp-hud-line` and
  the felt budget all derive from it, so the felt gives up the strip and
  Previous Hand rises with the row. Label and amount type grow with it.
- **Hero strip** (`TablePage.css`): `--sp-hero-clear` holds the hero's plate
  AND hand label. Measured across 486 to 598px felts, 6 and 9 seats, that box
  ends `0.1075 x felt width + 44.7px` under the scaler; the strip is solved
  from that the same way the plate-only rule is (width-bound and height-bound
  terms, smaller wins). The 2..6 seat canvas now rests on the floor of its
  budget (`--sp-short-table-drop: max(18px, 4% of the budget)`; the box itself
  is unchanged, see the note in the CSS), so a six-handed hero meets the row
  exactly like a nine-handed one, and the spare length goes to the top seat.
- **Insets** (`useTableEnvironment.ts`): read once, before the scale switch,
  beside the existing stable viewport height, and published in desktop-layout
  px as `--sp-phone-safe-top` / `--sp-phone-safe-bottom` (with the installed
  app's 60px status bar floor). The tab bar's `--sp-tabbar-safe-top`, the route
  table's top inset and the action row's `--sp-bar-inset` take the larger of
  that and `env()`, so a browser that does scale `env()` is never charged
  twice. `tests/unit/feltReserveIsStatic.test.ts` now names these three device
  constants explicitly as the only JavaScript-written inputs to the felt budget
  and pins that only the viewport hook declares and writes them.
- **Pill** (`TableTabBar.tsx/.css`): the transient last-action chip, its
  timers and the `lastAction` plumbing from TablePage through MultiTablePage
  are deleted. The hero's action is printed on the hero's own seat
  (`.seat__action`), as every opponent's is. The animation law's discard pin
  and the multi-table beat for that chip move with it.

## Hero avatar

Measured at the phone table with initials, photographs and character art on
both sides (6 and 9 seats, 360 to 430px): the hero's circle and painted
portrait were already never smaller than an opponent's (the 2026-11-09 cap in
`opponentAvatarLayout.ts`). No size change was needed in this layout; the gate
now pins it in a real browser.

## Measured after (600px layout px; device px for the notch)

| Phone, ring               | Button         | Row top to label foot             | Top control (device px) |
| ------------------------- | -------------- | --------------------------------- | ----------------------- |
| 375x667 6 / 9             | 104 (was 51.8) | 9.8 / 7.5 (was -1 / -15)          | 69.0 (was 46.9)         |
| 390x844 6 / 9 / Lightning | 104            | 9.4 / 7.0 / 9.4 (was 8 / -12 / 8) | 69.4 (was 48.7)         |
| 430x932 6 / 9             | 104            | 9.4 / 6.9 (was 8 / -11)           | 70.5 (was 53.8)         |
| 360x640 6 / 9             | 104            | 10.0 / 7.8 (was -1 / -14)         | 68.6 (was 45.0)         |

## Gate

`tests/live-turn/phone-table-layout.pw.ts`, the built app with an in-browser
engine, run in CI as "Phone table bottom row, hero seat and notch gate"
(css-beats general shard 3). It fails on the build before this change in all
ten cases.
