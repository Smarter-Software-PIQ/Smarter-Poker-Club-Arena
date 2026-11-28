# The Page Help Popup Wears #SmarterDesign (2026-11-27)

## What was wrong

The popup opened by the chrome "?" (`src/components/help/PageHelp.tsx`) was a
flat rounded box in the generic metallic popup chassis: a blue top rail, a
grey browser-style Close, plain Got It and Start Tutorial buttons.

## What changed

- The panel now wears the arena workspace language from
  `src/components/lobby/ArenaWorkspace.css`: the thin chrome case
  (`chrome-case.webp`, `41 / 19px` nine-slice) on the arena panel background,
  an `arena-section-title` style heading (condensed 800, white over a `#253e57`
  hairline), body copy in `#dce5ef` and the step count in `#9fbacc`.
- Close, Got It and Back are chrome-stat buttons (`chrome-stat.webp` on the
  dark tile); Start Tutorial, Next and Done carry the lit blue active chrome
  (`chrome-active.webp`). `:active` and `:focus-visible` only, no hover. A
  forced-colors fallback draws plain system borders.
- Every rule lives in `src/components/help/PageHelp.css`, unscoped: the help is
  portalled to `<body>` and opens on pages inside and outside
  `.arena-workspace`. The dialog carries `data-popup-chassis="none"` so
  `metallic-popups.css` no longer repaints it.
- Behaviour, focus handling, Escape, every label, `aria-*` attribute and string
  are unchanged ("Page Help", "Close Help", "About This Page", "Start
  Tutorial").

## Proof

Renders before and after: `/home/claude/renders/page-help-popup-393.jpg`
(plain page and inside an arena workspace) and
`/home/claude/renders/page-help-popup-1440.jpg`.
