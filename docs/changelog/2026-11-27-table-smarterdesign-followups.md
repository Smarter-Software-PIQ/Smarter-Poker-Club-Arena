# The table #SmarterDesign: what #12280 did not reach (2026-11-27)

#12280 put every table console, the purchase popups, the drawer, Buy-In and Leave on the
#SmarterDesign skin. Every table surface rendered at 393px and 1280px against canned rows and a
fake engine socket afterwards showed five places still in the old dress or wrong:

- **The drawer never changed.** `TableMenu` portals its drawer to `document.body`, so it is not
  a descendant of `.table-menu`. Every #SmarterDesign rule was written `.table-menu
  .table-menu__*` and matched nothing in the app. The rules now anchor on `.table-menu__dropdown`.
  ON readouts light cobalt from the row's own `aria-checked`, Close is in Title Case, LIVE is ice
  blue and the reconnecting state is silver (it was amber).
- **Leave Table rounded a cash stack**: 412.50 printed "413" (Dan 2026-11-13: real figures are
  never rounded). It prints `exactChips`. Tournament chips stay whole.
- **Game Rules** printed "nlh Rules" once the painted uppercase transform retired. It prints
  "NLH Rules", and its tab row is the workspace switch.
- **Toggles and tabs on a console's glass** (time bank quantities, leaderboard ranges) were lit
  words from the painted master. They are chrome keys now, with the chosen one lit cobalt.
  A key that carries a picture (a controller theme swatch) keeps its own frame.
- **Chat** (`TableChat.css`, the sheet's one stylesheet) is on the material: one chrome rim,
  chrome close and send keys, own bubbles lit cobalt, quick lines as chrome keys. The dealer
  line was amber and the mention highlight was gold; both are ice blue.
- **Hand Detail**: the full-screen sheet's head started under the tab strip ("Hand Detail" was
  cut off), so it now starts below the strip. The lone Close is a chrome key, and the winning
  hand, private tag, primary rake share and card glow are ice blue (they were gold).

Unchanged: the felt, cards, chips, avatars and the player's Action Controller skin; no handler,
engine or money change. Pinned by `tests/components/table-drawer-is-portal-safe.test.ts`.
