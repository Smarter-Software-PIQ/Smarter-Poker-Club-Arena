# Agent Team Commissions and Players tab bodies, and the player record's cash out panel, wear #SmarterDesign (batch 7)

2026-11-28. Client only: CSS and markup. No handler, guard, hook, string, role,
aria, number format or data hook changed.

## What changed

- **Commissions tab** (`AgentCommissionDashboard`): Summary / Records /
  Sub-Agents are an `arena-switch` (the open tab lit by its existing
  `.active`). Automatic Weekly Settlement, Records and Sub-Agents each sit in an
  `arena-case` (the settlement note under an `arena-section-title`). The four
  figures are `arena-meter` tiles (Total Earned in the live ink, Unpaid
  Commission in the pending ink). Commission Flow lost its inline rounded box
  and off-schema colours: it is a chrome `arena-ledger-row` with field-glass
  measures filled in the live ink (Pending in the pending ink). Each sub-agent
  is a chrome row. View Invoices and every Try Again are one lit chrome key
  instead of the gold button. Paid / unpaid read in the success / pending inks,
  still capitalised by CSS as before.
- **Players tab**: Player Search, Distribution History and Agent Analytics are
  each an `arena-case` under an `arena-section-title`. The Username / Id keys,
  the search key, each player's view and exclude keys (44px) and the
  7d / 30d / 90d / All range keys are chrome keys; the two text fields are the
  workspace's field well (16px so iOS does not zoom); totals and headline
  figures are `arena-meter` tiles; players, sends, secondary counts, top
  recipients and the loading placeholders are chrome rows. Status, promo and
  clawback marks are words in their inks, not pills; the weekly bars fill with
  the live ink in field-glass wells.
- **Player record**: the Cash Out Requested panel passes `arena` to
  `AgentCashoutPanel` (the page root is `member-mgmt-page arena-workspace`), so
  it wears the thin chrome case from PR #12319 like its neighbours. The
  Cashier's dialog keeps the painted console.

Dress lives in `AgentCommissionArena.css`, `PlayerSearchArena.css`,
`DistributionHistoryArena.css` and `AgentAnalyticsArena.css`, each imported by
its component, every selector scoped under `.arena-workspace`. The old sheets
are untouched.

## A defect the render found

`src/components/common/Search.css` declares a bare `.search-results` dropdown
(`position: absolute; top: 100%; max-height: 300px`). It matched Player
Search's results list too, so on main a search's results were drawn out of
their card, behind Distribution History, and could not be read. Inside the
arena workspace `PlayerSearchArena.css` puts the list back in flow. The bare
global rule is unchanged (outside this lane's scope).

## Proof

- `tests/components/agentTeamCommissionsPlayersArePinned.test.tsx`: every
  printed figure, the printed text, named regions and controls with disabled
  state for all four components in every state (loaded, empty, failed, busy,
  signed out), recorded against main `585373a71` before any change and
  unchanged after; plus the record's panel reading word for word the same on
  the arena case as on the console.
- `tests/unit/agentTeamCommissionsPlayersArenaIsScoped.test.ts`: every
  selector scoped, no gradient, hover or upper case, radius and shadow only
  ever taken away (`0` / `none`), each sheet imported by its component.
- `tests/unit/agentTeamArenaDressIsScoped.test.ts` now expects the record to
  opt in and still refuses `arena` on the Cashier dialog.
- Before/after renders at 393 and 1280 with the full-page harness.

## Not changed

- The sub-agent card's `.avatar` span prints `avatarUrl` as text (an existing
  defect: a URL where a picture belongs). Strings were out of scope; the arena
  sheet hides it only when empty.
