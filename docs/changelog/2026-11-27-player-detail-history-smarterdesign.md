# Player Detail: the Player Change History in #SmarterDesign (2026-11-27)

The club-wide Change History at the bottom of Player Management moved into the arena workspace
case in #12235. The per-player history on the player detail page (`MemberManagementPage.tsx`)
still sat in a plain `mm-card` with cyan text links and underlined fields.

## Change

The player detail history now renders inside the same `ChangeHistoryCase` from
`src/components/club/RosterRecords.tsx`: the thin chrome case with the Change History / Staff Only
section title, the disclosure as a chrome ledger row, the fields as the roster search well,
Apply Dates and Refresh History as chrome-stat buttons (Refresh lit), and each audit record on its
own chrome ledger row. The page root is already `.arena-workspace`, so the `RosterRecords.css`
scope applies with no new wrapper and nothing else on the page is restyled.

`PlayerChangeHistory` logic, markup and copy are unchanged; the case is only shown to staff, the
same gate as before.
