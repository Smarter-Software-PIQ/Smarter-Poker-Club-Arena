# The poker table in #SmarterDesign (2026-11-27)

Dan, verbatim: "POKER NEAR ME, https://smarter.poker/hub/club-arena/table/... NEEDS THE SAME
#SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE, EXACTLY LIKE WE'VE
DONE FOR EVERY OTHER WORLD HUB PAGE... MAKE ANY AND ALL OPTIMIZATIONS, ENHANCEMENTS, UPGRADES AND
SIMPLIFICATIONS NOW." Earlier the same day, on the painted console frames: "NO DO NOT USE THOSE
BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE."

#SmarterDesign in Club Arena is the arena workspace material the Cashier and the top of Player
Management wear (`src/components/lobby/ArenaWorkspace.css`): solid ink-navy glass, one thin
nine-slice chrome rim per surface (`console-art/chrome-*.webp`), a white Title Case title, silver
supporting text, ice-blue emphasis, chrome keys with the chosen or primary one lit cobalt, 44px
targets and a visible focus ring.

## What changed

- **Every table console** (`src/components/console/SpadeConsole.tsx` + `.css`). A new
  `ConsoleMaterialProvider` / `material` prop. `TablePage` provides `smarter` around every live
  table; React context follows a portal, so popups rendered into `document.body` get it too. Under
  it the painted head, rails and plates retire: the head is a grid (eyebrow, title, readout pill, a
  labelled 44px close key), the body prints on the glass, the plates are chrome keys
  (`data-plate="primary"` lit cobalt), and toggles and tabs on the glass become the workspace switch.
  This covers Table Settings, Buy-In (seat-first), Hand History, Hand Detail, Game Rules,
  Leaderboard, Real Time Result, Time Banks, the hit-and-run Leave Table, Sit Out, Wait List,
  Post Or Wait, the tournament popups and the rest. Off the table the default stays `painted`, so no
  other surface changed. The four multi-table consoles (crashed tile, no tables, session, quick join)
  pass `material="smarter"`.
- **Table menu drawer** (`TableMenu.css`): ink-navy glass with one chrome rim, ice-blue section
  labels over hairlines, a chrome Close key, ON / OFF as chrome readouts (ON lit cobalt from the
  row's own `aria-checked`), the reconnecting state silver instead of amber.
- **Leave Table confirm** (`LeaveTableConfirm.css`): the material, Stay lit as the safe default,
  Leave Table in red ink. The cash figure now prints exactly (`exactChips`): a 412.50 stack showed
  as "413" (Dan 2026-11-13: real figures are never rounded). Tournament chips stay whole.
- **Buy-In sheet** (`BuyInModal.css`): the painted spade head and four-bay deck retire; the amount
  is a chrome readout, Min / BB / Max / Balance are chrome tiles (Min and Max light when chosen),
  Close / Buy Chips are chrome keys. The slider still runs up and down (Dan 2026-09-05).
- **Add-On, Top Up and Rebuy** (`AddOnModal.css`, all callers are table popups): the painted
  October 9 chassis retires; title white (was green), figures ice-blue (balance was gold), the
  amount in a chrome readout, presets and plates as chrome keys, and the close prints its own X.
- **Hand Detail** (`HandDetailModal.css`): the painted-head crop stands down under the material,
  the sheet starts below the tab strip instead of under it, and every gold ink (winning hand, private
  tag, primary rake share, the playing-card glow) is ice-blue.
- **Chat** (`TableSmarterDesign.css`, new, imported by `TablePage`): the sheet, header, close and
  send keys, bubbles (own lit cobalt), quick lines as chrome keys; the dealer line and the mention
  highlight were amber and gold and are ice-blue.
- **Game Rules**: the title printed the raw variant ("nlh Rules") once the painted uppercase
  transform retired; it now prints "NLH Rules". Its tab row is the workspace switch.

## Not changed, on purpose

- The felt, room background (still blurred), cards (4-color default), chips, dealer button, seat
  avatars and the pot readout on the felt: they are the authentic Arena table.
- The Fold / Check / Call / Raise bar and the raise panel are the player's own **Action
  Controller** (Table Settings, Action Controller tab, `ActionController.css`,
  `data-controller-color`): a chosen skin. Repainting it would override the player's choice.
- No engine, server, money or sound behaviour; every handler, guard, timer, focus trap and
  test-pinned literal (the hit-and-run text included) is unchanged.

## Verification

Rendered in headless Chrome at 393px and 1280px against canned Supabase rows and a fake engine
socket (the `production-*` and `gameplay-customization-runtime` specs' approach): seated on the flop
with the action on the hero, the menu drawer top to bottom, every popup above, the observer seat and
the hit-and-run Leave. Pinned by `tests/components/tableConsolesWearSmarterDesign.test.tsx`.
