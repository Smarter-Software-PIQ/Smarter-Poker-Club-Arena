# #SmarterDesign, the money pages in one full pass: Financials, Diamond Wheel ops, Diamond Games ops

Batch 4 converted these three pages but left their embedded money panels on
the painted console, and a screen that mixes painted and chrome frames looks
worse than either. This pass converts each page whole, embeds included, so no
screen ships half and half.

## Figures first

Before any frame moved, every embedded money component got a pin on every
figure it prints and every data-_ hook it carries
(`tests/helpers/moneyFigures.ts`: each printed string with a digit, in DOM
order, plus every data-_ attribute; dates and times are tokens). The pins were
written against the painted components and pass unchanged after conversion:

- `RakeReports` (`tests/components/rake-reports-console.test.tsx`)
- `ClubFinancialDashboard` (`tests/components/club-financial-dashboard-console.test.tsx`)
- `ChipStatement` (`tests/unit/ChipStatement.test.tsx`), plus a test that
  the arena case prints exactly the same figures and hooks as the painted one
- `TransactionLedgerView` (`tests/components/transaction-ledger-scope-race.test.tsx`)
- `DynamicWallet` (`tests/components/surfaces-dynamic-wallet.test.tsx`)

## Frames

- Financials: the page's ten consoles, `ClubFinancialDashboard` (only shown
  here) and `RakeReports` and `ChipStatement` (opt-in `arena`; the Cashier's
  Rake Treasury dialog and the wallet and history pages keep the painted
  console) print in the thin chrome case. The reporting windows are chrome
  switches. The ledger rows take the workspace hairline. The wallet panel
  (`DynamicWallet`) sits in a chrome case with its props and its own approved
  row art unchanged.
- Diamond Wheel ops and Diamond Games ops: every section, including
  `DiamondGamesMoney` (The Money, The Room, Who Is Playing), Daily Diamond
  Statements and the Owner Agreement (opt-in `arena`; the welcome package keeps
  the painted one), prints in the chrome case. The shared
  `diamondGames.module.css` rules are scoped to `.page.arena-workspace`, so
  the player game pages are untouched, and the column keeps its 640px width.

## The law that pinned the painted chassis

`tests/the-operator-sees-the-money-and-the-room.law.test.ts` pinned
`DiamondGamesMoney` to the painted console (2026-09-11). Dan's later ruling of
2026-11-27, verbatim "NO DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE...
USE THE #SMARTERDESIGN STYLE FOR THESE." (recorded in
`.claude/skills/smarter-design/SKILL.md`), supersedes it for routed page
sections under CLAUDE.md 10.8 (the latest explicit owner instruction wins). The
law now pins the arena case and still forbids any drawn frame; every assertion
about the money and room figures is unchanged. Its `docs/laws.d` entry says so.

`tests/e2e/financial-admin-deep.spec.ts` asserted a painted console head on
every linked financial console; Club Disputes (converted in batch 3) and
Financials now assert the arena chrome case instead.

No number formatting, text, handler or test hook changed.
