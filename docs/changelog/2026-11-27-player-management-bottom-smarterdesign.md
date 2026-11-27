# Player Management: the bottom of the page in #SmarterDesign (2026-11-27)

Dan, with a screenshot of the roster footer: "ALL OF THIS ON THE BOTTOM OF THE PLAYER
MANAGEMENT PAGE NEEDS TO BE UPGRADED WITH THE #SMARTERDESIGN". A first pass rebuilt it on the
painted spade console; Dan: "NO DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE... USE THE
#SMARTERDESIGN STYLE FOR THESE." That pass was discarded before it shipped.

## Before

Bare black under the roster: a "Loaded 80 Of 172" line, a gold-ruled CSS Select Loaded button
beside a blue-ruled CSS Export CSV bar, the Export Scope line, a boxed Metric Definitions
disclosure, and the Club Player Change History as plain cyan text with flat links.

## After

Two cases in the arena workspace language the top of this page and the Cashier already wear
(`ArenaWorkspace.css`), in `src/components/club/RosterRecords.tsx`:

- **Roster Export**: the thin chrome case and section title, three chrome readout tiles
  (Loaded, Matching, Selected), Select Loaded / Clear Selection and Export CSV /
  Export Selected (n) as chrome-stat buttons with the primary lit blue, the export scope and the
  export receipt, and Metric Definitions as a chrome ledger-row disclosure.
- **Change History**: the same case; the audit disclosure as a ledger row, its fields as the
  roster search well, Apply Dates / Refresh History / Show Older Changes as chrome-stat buttons,
  and every audit record on its own chrome ledger row.

The page still owns all state and handlers; every test-pinned literal and role is unchanged.
