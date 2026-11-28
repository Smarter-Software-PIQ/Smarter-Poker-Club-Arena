# The table: the last gold and the capitals the transform used to hide (2026-11-28)

Follow-up to #12321 (`2026-11-28-table-smarterdesign-leftovers.md`), which removed every
uppercase transform from the table's sheets and left the keyframes and the masthead alone.

## Gold inside the animations

- **Tab strip turn pulse** (`@keyframes pulseGlow`, `TableTabBar.css`): the glow and drop
  shadow were gold (`rgba(255, 215, 0, ...)`); they are ice (`rgba(116, 223, 255, ...)`) at the
  same alphas.
- **Tournament winner sparkles** (`.sparkle`, `TournamentWinnerOverlay.css`): the dot was a
  cream-to-gold gradient with a gold glow; it is white to ice (`#ffffff` / `#74dfff`).

Only colours changed. Every duration, timing function, iteration count, delay and transform
path is byte-identical, and `tests/animations-always-play.law.test.ts` passes untouched.

## Stored values and literals the transform used to shout

With the uppercase transform gone, anything printed in capitals at the source shows in
capitals. Audited every sheet #12321 swept (149 rules) for what prints a stored value or a
literal:

- **Table header game label** (`getGameVariantLabel`, `tableCardDisplay.ts`): every label was a
  capitals literal ("NO LIMIT HOLD'EM") and the fallback upper-cased the stored key. Now Title
  Case ("No Limit Hold'em", "PLO Hi-Lo (8+)"), and an unknown key goes through
  `enumToTitleCase` so acronyms stay upper case.
- **Tab strip**: the decision labels (Discard, Insure, Run It), Seat and Time Bank.
- **Masthead bomb pot line**: Bomb Pot Next Hand, Bomb Pot In 2:47, Bomb Pot In 3 Hands, Bomb
  Pot Only, Bomb Pot Waiting For N Players, Triple Board (the live felt pill shares the text).
- **Tournament announcements**: Hand For Hand, Bubble Burst!, Final Table, Level N, Bounty
  Claimed, Knockout!, Mystery Bounty!, Seven-Deuce Bounty, "- Jackpot!".
- **Bad Beat Jackpot info** eyebrow: Bad Beat Jackpot / Mini Bad Beat Jackpot.
- **Hand Detail** showdown tag: Bad Beat.

Already correct and left as is: positions (UTG, BB ... are abbreviations at the source), the
Must Move lobby table state, the tournament dock status and info panel tabs and table heads, the
Diamond wallet balances, the spectator list header ("Spectators"), hand flag status, Theme
Studio tier badges, the pot share labels and every BBJ figure.

## Off-table painted consoles (`.sc-label`, `sc__title`, eyebrow, pill)

#12321's `SpadeConsole.css` change reaches every painted console. `check-title-case.mjs`
already proves every static JSX word and every `eyebrow` / `title` / `subtitle` / `pill` /
`label` field starts with a capital, and a scan of the 465 `sc-label` sites found no lowercase
literal. The one shouted copy field was the BBJ eyebrow above.

## Masthead names

`.table-brand__line` no longer transforms. Club and union names (both masthead branches) and a
custom cash game name go through the new `titleCaseName`: a name typed in one case ("KINGS
CLUB", "kings club") prints in Title Case with acronyms kept ("Midway PLO Union"); a name typed
in mixed case ("The Felt Society", "iPoker Nights") prints exactly as typed. The short game code
(NLH, PLO4) is upper case at the source and is unchanged.

## Hand Detail column key

`Player / Action / Amount / Stack` inside the skin is silver `#9fbacc` at weight 600: 7.5:1 on
the console's lightest navy (`#12273b`), pinned by a computed contrast test.

## Left alone, and why

- The club lobby cards (`ClubCardPanel`, `DiamondArenaCard`) still print ACTIVE, MEMBERS,
  LEVEL, NEXT FREEROLL and LIVE ACROSS ... as capital literals. That is an owner-designed card
  label style with its own law (`a-union-member-club-card-reports-the-union.law.test.tsx`), and
  it was never affected by #12321.
- The tab pill game codes (SPIN, SHORT, PINE, MTT, SNG, HU from `utils/gameCode.ts`) are short
  codes, kept as codes.
- `document.title` "YOUR TURN - ..." in `MultiTablePage` is the browser tab title, not a sheet.
- The tournament announcement colours, the scoop and run-board felt banners and the felt art.

## Pinned

`tests/components/table-visual-leftovers-are-ice.test.ts` (keyframe and sparkle colours with
their animation declarations, masthead transform and `titleCaseName` calls, `titleCaseName`
cases, game label and tab labels, colkey contrast). Updated in the same commit:
`TableCardDisplay.test.ts`, `bombPotGuards.test.ts`, `sitOutClockIsTheServers.test.tsx`,
`tourneyUxSweep20260825.test.tsx`, `the-mini-is-seen-and-discoverable.law.test.ts`.
