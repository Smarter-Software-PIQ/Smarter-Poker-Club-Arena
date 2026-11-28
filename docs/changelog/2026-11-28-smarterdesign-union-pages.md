# The Union pages wear #SmarterDesign (batch U1)

Dan, 2026-11-27: "THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE".

## What changed

- **Unions** (`/unions`), **Union Command** (`/unions/:unionId`), **Forge A
  Union** (`/unions/create`) and **Union Data** (`/unions/:unionId/data`) moved
  from their own gradient and painted-plate dress to the arena workspace: the
  chrome mast with the chrome "?", thin chrome cases with section titles,
  chrome readout tiles, chrome keys with one lit primary, dark wells and
  chrome ledger rows. Union Data follows Club Data's layout.
- The arena pages print their empty, error and loading states through a new
  module, `src/components/common/EmptyStateArena.tsx`: the same words, roles
  and keys as `EmptyState`, on the arena state screen. `EmptyState.tsx` is in
  the entry chunk, so it stays untouched and the arena dress rides the arena
  pages' lazy chunks. A first cut imported the dress from `EmptyState.tsx` and
  the entry-chunk gate refused it.
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
