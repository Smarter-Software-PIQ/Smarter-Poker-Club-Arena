# Every Console Off The Table Wears #SmarterDesign (2026-11-27)

Dan, 2026-11-27: "THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE,
SUBPAGE, BUTTON AND EVERYTHING ELSE". The table layer already dressed its
consoles in the arena workspace language (`MultiTableSurface.tsx`, #12280).
Every other SpadeConsole in the app (about 160 callers: lobby, club home,
profile, achievements, cashier, tournaments, wallet, agent and union panels,
settings, and the root-mounted welcome, terms and push dialogs) still wore the
painted master.

## What changed

- `src/App.tsx` wraps the whole app in
  `<ConsoleSkinProvider value="smarterdesign">`. One provider, no caller
  touched; portals inherit it because React context follows the tree, not
  the DOM.
- The context default stays `painted`, so a component rendered on its own (a
  unit test, the render harness) still shows the master it was measured on.
- The skin context moved out of `SpadeConsole.tsx` into
  `src/components/console/consoleSkin.ts`, so the component file exports only
  components. Its two `react-refresh/only-export-components` warnings (from
  #12280) had put Client lint at 1089 against its 1087 cap, failing every open
  pull request. The new ten-line module is a reviewed first-paint addition
  (`scripts/ci/entry-chunk.d/feat-smarterdesign-offtable-consoles.json`).

## Verified

Rendered at 393px, painted against smarterdesign, with
`data-console-skin="smarterdesign"`, no element past the viewport and no
clipped text in the smarterdesign renders: Confirm (Leave Club), Bad Beat Jackpot
info, Block Player, VIP Membership, Player Notice, Terms Of Service, and the
Club Arena welcome. The painted versions of Player Notice and the welcome both
cut off their titles; the workspace dress lets those titles wrap.

Pinned by `tests/components/offtable-consoles-wear-smarterdesign.test.tsx`.
