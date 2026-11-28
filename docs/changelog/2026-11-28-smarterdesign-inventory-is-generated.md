# The #SmarterDesign inventory is generated from the code (2026-11-28)

## Why

`docs/club-operations/SMARTERDESIGN-INVENTORY.md` was kept by hand and went
stale within a day: PR #12312 converted seven pages (Anti-Cheat, Agent
Network, Promo Vault, Agent Team, Table Management, Diamond Costs, Agent
Dashboard) while the document still listed them as to-do, and two lanes
started the same work. The #ClubArenaConsole scanner
(`find-generic-surfaces.mjs`) could not help: it reports "0 to go" because it
measures distance from the painted master, so a page on painted
`SpadeConsole` plates counts as finished there. Under #SmarterDesign (Dan,
2026-11-27) those plates are "THE OLD STYLE" on a page.

## What changed

- `scripts/smarterdesign-inventory.mjs` (new). Resolves every `<Route>` in
  `src/App.tsx` to its page module (guards, boundaries and layouts skipped,
  aliases such as `ClubPageSection as SpadeConsole` resolved through the
  imports) and grades it from markers in source: `arena-workspace` root,
  `ArenaWorkspaceHeader` mast, arena sections, painted console sections
  (popups excluded), and the page's own module dress. Grades: converted,
  partial, not converted, UNKNOWN (the evidence could not be read; never
  counted as done), excluded (a commented list), and pages that render
  nothing (redirects). It accounts for the root
  `<ConsoleSkinProvider value="smarterdesign">` from PR #12299: the skin dresses
  every `SpadeConsole`, and is reported as a skin, never as a conversion. A
  shared component with an opt-in `arena` prop is read only on the pages that
  pass `arena`.
- `--claims [filter]`: lists the open pull requests touching each page still
  to convert (the page, its sheets, its page-owned components), read through
  the REST API. Advisory only: no hook, no timer, never blocks. If GitHub cannot
  be read it prints UNKNOWN and exits 3, never "unclaimed" (CLAUDE.md 10.86).
- `docs/club-operations/SMARTERDESIGN-INVENTORY.md` is now the generator's
  output. The hand-written batch tables moved, unchanged, to
  `docs/club-operations/SMARTERDESIGN-HISTORY.md`.
- `tests/the-smarterdesign-inventory-matches-the-code.law.test.ts` (+ its
  `docs/laws.d` entry) fails when the committed inventory differs from the
  scanner, names the one command to regenerate
  (`node scripts/smarterdesign-inventory.mjs --write`), and refuses an empty
  scan, a Club Operations reference page that stops reading as converted, a
  "converted" page with painted plates, and an exclusion that names no page.
- `find-generic-surfaces.mjs` keeps its counts (its `--json` is pinned by
  `tests/unit/consoleInventoryIsHonest.test.ts`) but its summary now says its
  "to go" is against the painted kit, and that routed pages are measured by
  the new scanner. The club-arena-console skill says the same.
- `.claude/skills/smarter-design/SKILL.md` section 5.5: how to read the
  inventory, the claim step, and the shared-component rule (scope the sheet
  under `.arena-workspace` or add an opt-in `arena` prop, with a unit test
  asserting the scoping; worked examples `WeeklyAccountingArena.css` with
  `weeklyAccountingArenaIsScoped.test.ts`, and `AgentCashoutPanel`'s `arena`
  prop with `AgentCashoutArena.css`).

## The first generated reading (main at `585373a71`)

51 not converted, 11 partial, 2 UNKNOWN, 33 converted, 29 excluded, 3 render
no page of their own. The full lists are in the inventory.

No visual change; no `src/` file touched.
