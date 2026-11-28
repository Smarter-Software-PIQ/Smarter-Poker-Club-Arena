# #SmarterDesign ratchet: one file per converted page

Every file in this directory except this note is one routed page that reads as
**Converted** to #SmarterDesign (an `arena-workspace` root, an
`ArenaWorkspaceHeader` mast, no painted console section left). The file is named
for the page's component and holds one line: the page module's path.

    docs/club-operations/smarterdesign.d/<Component>   ->   src/pages/<Page>.tsx

You never write one by hand. When your PR converts a page, run:

```bash
node scripts/smarterdesign-inventory.mjs --ratchet
```

It adds the entry for every converted page that has none, and never deletes one.

`tests/the-smarterdesign-inventory-matches-the-code.law.test.ts` holds the
directory, so the Converted count only grows:

- every entry must still read as converted (a page that loses its root or mast,
  or gains a painted section, fails loudly);
- every converted page must have an entry;
- no entry on the base branch may disappear while its page is still routed and
  graded. Deleting an entry is not how a regression is fixed; restoring the page is.
  An entry goes only when its page leaves the routes, or is moved to the script's
  `EXCLUDED` list by a written ruling.

Why one file per page: two lanes that convert two pages add two different files
and can never conflict. The full inventory is printed on demand and never
committed (`node scripts/smarterdesign-inventory.mjs`, `--write`).
