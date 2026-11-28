# The Union pages wear #SmarterDesign (batch U1)

Dan, 2026-11-27: "THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE".

## What changed

- **Unions** (`/unions`), **Union Command** (`/unions/:unionId`), **Forge A
  Union** (`/unions/create`) and **Union Data** (`/unions/:unionId/data`) moved
  from their own gradient and painted-plate dress to the arena workspace: the
  chrome mast with the chrome "?", thin chrome cases with section titles,
  chrome readout tiles, chrome keys with one lit primary, dark wells and
  chrome ledger rows. Union Data follows Club Data's layout.
- `EmptyState`, `ErrorState` and `LoadingState` take an opt-in `arena` prop
  that prints the same words, roles and keys on the arena state screen.
  Without it nothing changes.
- The retired module sheets (`CreateUnionPage.module.css`,
  `UnionDataPage.module.css`) are deleted; `UnionDetailPage.module.css` keeps
  only the club selector dialog.

## How it was held

Every printed figure, word, data hook, named region and control state of the
four pages was pinned on unchanged main in every state they show, in the
first commit, and the pins hold unchanged after the conversion. Every new
rule is scoped under its page's arena root
(`tests/unit/unionPagesArenaDressIsScoped.test.ts`). Tests that named the old
dress (`cinematicRouteFamilies`, `productCompletionVisualAcceptance`,
`clubArenaAccessibilityFoundation`, `data-console-family-contract`,
`a-union-lead-needs-no-club.law`) now hold the arena version of the same
guarantee.

## Not in this batch

UnionDashboardPage, UnionGamesPage and UnionStatementsPage (open #12313 edits
them), and the insides of RakeSnapshotPanel and UnionClubGovernance (also
#12313). Details in `docs/club-operations/SMARTERDESIGN-HISTORY.md`, batch U1.
