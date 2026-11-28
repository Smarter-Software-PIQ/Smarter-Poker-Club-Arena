# The converted #SmarterDesign pages pass an axe WCAG 2 A/AA audit

An axe audit (`@axe-core/playwright`, tags wcag2a + wcag2aa, scoped to
`.arena-workspace`) ran over 27 converted pages in the render harness at 393px.
25 were clean. Two defects, fixed here:

- **Player Management, critical `aria-required-children`.** The directory is
  `role="list"` named "Club Member Directory", and its error states put a
  `role="alert"` straight inside it; a list may only own list items. Every
  state shown in place of the rows (loading, not found, access denied, load
  error, empty) now sits in one plain `role="listitem"`, so the list keeps its
  role and name, which many specs select it by, in every state. No class or
  layout change.
- **Club Settings (Audit Log), serious `color-contrast`.** The action filters
  and the empty-state line used `--text-muted` (#6b7280) on #111827, 3.66:1,
  under AA's 4.5:1 for a 16px label. They use `--text-secondary` (7.5:1). The
  same bare `.empty-state p` rule in `PlayerSearch.css` had the same contrast
  and is fixed with it.

Re-audited after the fix: Settings, Player Management and Agent Team clean.
Pinned by `tests/unit/playerDirectoryAndAuditFiltersPassAxe.test.ts`.
