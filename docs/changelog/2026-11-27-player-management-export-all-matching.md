# Player Management: Export All Matching, desktop layout, roster footer accessibility (2026-11-27)

Lane: club-arena-client. Read and export only; no money moves and no migration.

## What the export did before this change

`handleExport` in `src/pages/ClubMembersPage.tsx` sends one call to
`ClubRosterService.exportRoster`, which runs the `ca_club_members_export` RPC
with the current search, filter and sort:

- **No selection:** `p_user_ids` is null, and the server returns every player
  matching the query across every page in one audited response (one
  `audit_trail` row, `row_count` checked against the rows). It was never limited
  to the loaded rows. The Export Scope note ("All Matching Players Across Every
  Page") was already accurate.
- **A selection:** `p_user_ids` is the selected loaded players (server cap
  5,000), further limited by the query.

What was missing: with a selection active there was no way to export every
matching player without clearing the selection first, and a preparing export
could not be cancelled.

## Export All Matching

- `RosterExportCase` shows **Export All Matching (Y)** beside Export Selected
  whenever a selection is active. It calls `handleExport('all')`, which uses the
  same server read with `p_user_ids` null and ignores the selection, which stays
  as it was. Without a selection the primary Export CSV already does exactly
  this, so a duplicate button is not shown.
- No client paging. The existing server read already returns every match in one
  audited response, and paging the roster read instead would skip the export
  audit row and the authorized export columns.
- **Cancel Export** shows while any export is preparing. It aborts the request
  (the abort signal reaches the RPC), starts no download and the receipt reads
  "Export Cancelled. No CSV Download Started."
- The receipt shows the full read as "Preparing Export Of All Y Matching
  Players." and names the mode ("Export All Matching: Every Matching Player
  Across Every Page, Ignoring Any Selection.").
- The Export Scope note now says, with a selection, that Export All Matching
  ignores it and reads all Y matching players. Metric Definitions says the same.
- The `canExport` gate is the same one: no permission means no export controls.

## Desktop layout (RosterRecords.css)

From 760px the export case puts its readouts and its action buttons on one row,
so there are no more 650px tiles and 970px buttons, and the copy keeps a
readable measure. Change History is sized by its own case through a container
query, so the half-width case on a player's record and the full-width case on
the Players page each get the right layout. From 480px of case width, Apply Dates
fills the cell that used to sit empty and each record's time sits on its title
line. From 720px the filters run on one line and Show Older Changes is a
centered control instead of a full-width bar. Below 480px of case width (every
phone) nothing changes.

## Accessibility

`tests/e2e/production-club-members.spec.ts` now runs axe on `.roster-records`
with Metric Definitions open and fails on serious or critical violations. axe on
the rendered footer (393, 768, 1440, both pages) found none. No vitest axe check
was added: the repo has no jest-axe/vitest axe pattern, and axe-core is only a
transitive dependency.

## Tests

`tests/components/playerCommandExportAllMatching.test.tsx`: one server read for
all matching players with a selection and one loaded page (CSV has 100 rows =
the matching total, no extra directory reads), progress and cancel, a refused
export, and the permission gate.
