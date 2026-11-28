# 2026-11-27 - The tournament lobby wears #SmarterDesign

Dan, 2026-11-27: every page, sub page and button gets the #SmarterDesign
upgrade, the Club Arena table included. The tournament lobby is one surface
reached three ways - the routed `/tournaments/:id` page, the lobby tab of the
multi-table screen and the in-game `TournamentLobbyModal` - all rendering
`src/pages/tournament/TournamentDetails.tsx`, so one change covers all three.

## What changed

- The lobby root carries `arena-workspace` and loads
  `src/components/lobby/ArenaWorkspace.css`, so the workspace's art variables
  resolve on this surface.
- `src/pages/tournament/TournamentLobbySmarterDesign.css` re-dresses the
  lobby's existing classes with them, replacing the heavier MTT console rims
  of `MttSurfaces.css` (32px case, 11px rows, steel lens) here:
  - every tab panel is one thin chrome case (`--arena-frame 41 / 19px`) on
    the case glass; a panel nested in a case is a section of it, not a second
    frame;
  - section titles are Roboto Condensed over the `#253e57` hairline, no
    forced capitals;
  - every figure (Remaining, Average Stack, Entries, Rebuys, table spreads,
    pool and payout tiles) sits on a readout tile (`--arena-stat 11 / 6px`),
    labels in `#9fbacc`, live values in `#74dfff`;
  - players, entries, tables, payouts and roster records are ledger rows
    (`--arena-row 13 / 6px`); the player's own row and first place are lit on
    the active rim;
  - the section rail, Invite To Game, Close, Share and every in-tab action are
    chrome-stat keys at 44px; the selected section and the go actions are lit
    blue, Register stays the one lit primary in the footer;
  - the full blind structure reads as a ledger instead of a spreadsheet grid,
    the current level lit.
- No markup, handler, test id or data binding changed. No new art, colour,
  radius, `:hover` or `!important`.

## Verification

Headless render of all eight tabs at 393px before and after, no element past
the viewport edge in any tab. `tests/unit/tournamentLobbyWearsSmarterDesign.test.ts`
pins the root class, the import order, the scoping and the workspace widths.
