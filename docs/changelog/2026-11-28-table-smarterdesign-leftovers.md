# The table #SmarterDesign: the leftovers measured live (2026-11-28)

#12280 and #12302 put the table's consoles, popups, drawer and chat on the #SmarterDesign
skin. A measured pass on the live table at 393px (build `c6ec86b`) still found capitals and
gold. Dan: "YELLOW IS NOT A APPROVED COLOR", and every label is Title Case.

## The named findings

- **Hand History list**: the tags (Tournament, Diamonds, Run 2x, Hi-Lo) and the Bomb Pot facts
  label were gold and printed in capitals; they are ice blue (`#74dfff`) in Title Case. "No
  Showdown" (`.hh-entry__tag--quiet`) was `#4a5462` on navy, nearly invisible; it is silver
  `#9fbacc`.
- **Hand Detail (a hand expanded in Hand History)**: inside a #SmarterDesign console
  (`.sc--sd`) the position badges (BB, SB, UTG ...) are chrome-ice tags; each action keeps a
  distinct tag from the skin's inks only (fold and muck dim silver, posts and discards silver,
  check white, call ice, bet and raise strong cyan with a cyan rim, all-in white on cobalt,
  show ice). The winner, bad-beat, private and all-in highlights are ice. Flag This Hand and
  Cancel are 44px chrome keys, Send To The Operators is the lit cobalt primary; Your Note is a
  white title over the section hairline, its fields are the workspace search well and Save Note
  is the lit cobalt primary. The handdetail components are also used on pages off the table,
  so these rules are scoped to `.sc--sd` and the base rules are unchanged.
- **Session Stats (Real Time Result)**: "BB Won" and "Observers (0)" were capitalised by the
  shared `.sc-label` rule in `SpadeConsole.css`; it no longer transforms.
- **Table Studio**: every label, tab, mode option, count, link word, section name and tier
  badge is Title Case ("Table Art Link", "Apply To", "Interface", "Light", "Dark"). The one gold
  rim (`rgba(255, 222, 137, 0.52)`) is the Gold Star Action Controller theme swatch, the
  player's purchased controller skin, and stays (see "Left alone").
- **Invite Online Friends**: the row buttons print "Invite" (the source already said it; the
  sheet capitalised it).
- **Drawer switches**: Sounds, Vibrations, Multi Table Profit Tracking, Auto Time Bank, Seat
  Change and every other switch read "On" / "Off" (the badge values were the literals `'ON'` /
  `'OFF'`). The row's checkbox state still follows the badge (`action.badge === 'On'`).
- **Game Rules**: section titles ("Cash Button And Blinds") and the tab row, feature words and
  hand titles are Title Case; the manual Bomb Pot line and the custom values are ice blue.
- **Loading cover**: "Loading Table" (`.table-art-cover__label`) is no longer capitalised.

## The sweep

Every stylesheet the table's consoles, popups, drawer and sheets load had its
`text-transform: uppercase` declarations set to `none` (Buy-In, Add-On, Club Profile, Emoji,
Hand Detail sheet, Heads Up waiting, Hero Hub, Hit And Run, Identity, Insurance, Lightning
lines, Maintenance Break, Must Move Lobby, Session HUD and Analytics, Settings, Share Hand, Sit
Out, Load Failure, the drawer, Table Settings, the tab strip, tournament notices and winner,
Wait List, the console itself, Log This Hand, the Bad Beat Jackpot info, the tournament dock and
info panel, the Diamond wallet and the multi-table page). The spectator list header lost its
inline uppercase.

Gold, amber, orange and purple UI ink moved to the skin: the tab strip's turn rim and action
timer (ice), the offline chip (silver), the pending-decision tab (white on silver), the hidden
table urgency bar (ice), the tournament stats chip rim (ice), the Session HUD bars (PFR ice,
loose silver, tight cyan, normal blue) and its hot badge (house green), the Share Hand stakes
chip (ice), the drawer's reconnecting state (silver, base rule too), the disconnect toast rim
(silver), the portrait lock prompt (ice), and the tournament winner's headline sheen and prize
(ice ramp, white prize; the sheen animation itself is unchanged).

## Left alone, and why

- The felt, cards, chips, seats and avatars (`SeatSlot.css`, `PotDisplay.css`,
  `CommunityCards.css`, card themes in `TablePage.css`), the table masthead lines
  (`.table-brand__line` prints club and union names from the database as typed), the
  Bomb Pot art, Bad Beat Jackpot celebration, particles and confetti.
- The player's Action Controller skin (`ActionPanel.css`, `PreActionBar.css`,
  `ControlThemeTokens.css`, the tile-grid action keys in `MultiTablePage.css`), including the
  Gold Star theme swatch in Table Studio: a purchased controller theme keeps its own frame,
  as #12302 ruled for controller swatches.
- Every `@keyframes` body: the tab strip's turn pulse still glows its old colours, and the
  winner sparkles keep theirs. No rule here sets `animation`.
- The full-screen Final Table and Heads Up stage art, the hand replay felt, and the Diamond
  top-up checkout's own gold variable.

## Pinned

`tests/components/table-surfaces-wear-smarterdesign-inks.test.ts`: no uppercase transform in
any of those stylesheets, no banned hue in the table-only sheets, every gold rule in the
handdetail sheets re-inked under `.sc--sd`, Save Note lit and Flag a chrome key, and the
drawer badges On / Off. `tests/unit/tableMenuSwitchesAnswer.test.tsx` and
`tests/unit/tabBarTopUpFollowsSeatCanAddFunds.test.tsx` now expect On / Off.
