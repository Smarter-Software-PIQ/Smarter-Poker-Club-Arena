# Two post-deploy client specs follow what production now draws

Post-deploy client verification run 46116364687 (SHA e11255d73) failed two
specs. Neither is a product defect.

- `tests/e2e/financial-admin-deep.spec.ts` asserted the painted console head
  background (`/assets/club-buttons/console/`) on the Financial Admin hub and
  the linked staff consoles. PR #12299 dressed every SpadeConsole off the table
  in its #SmarterDesign skin (`data-console-skin="smarterdesign"`, a chrome case
  laid on `::before`), so that background is gone by design. The check is now
  `expectSpadeConsoleCase`: the console carries the smarterdesign skin, keeps
  its head, and its rim is `smarterdesign-v1/chrome-case`.
- `tests/e2e/tournament-watch.spec.ts` located the top action bar with a bare
  class. Off a table route MultiTablePage pins a copy of the strip; for the
  frame between the URL reaching `/table/` and React rendering the felt, both
  are in the DOM, and Playwright fails a strict-mode violation at once rather
  than retrying. The locator now excludes the pinned copy.
