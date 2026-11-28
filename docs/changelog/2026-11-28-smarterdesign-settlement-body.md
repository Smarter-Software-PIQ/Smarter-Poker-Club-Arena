# The Settlement body wears #SmarterDesign

Batch 3 (#12296) moved the Weekly Accounting page shell into the arena
workspace but left its body, `WeeklyAccountingWorkspace`, printing lit words
on black rules inside the chrome case. This pass finishes it.

- The heading is the case's section title.
- Week Ending Monday is a chrome row with the date in a dark well.
- The automatic run status sits on a chrome row; Refresh Status is a lit key.
- Club Weekly Summaries sit under a hairline, Refresh lit and Export steel,
  and the table rides a chrome row rim with meta-ink labels.
- Recorded union periods are one chrome row each.
- Open Club Cashier And Records is a chrome key.

The dress is `src/components/accounting/WeeklyAccountingArena.css`, scoped
under `.arena-workspace`, because the same components render on the
Settlement Dashboard, the Union Statements board and the admin dashboard,
which are not arena workspaces and keep their look
(`tests/unit/weeklyAccountingArenaIsScoped.test.ts`).

Money screen rule: every printed figure, word and named region was pinned
against the old components first
(`tests/components/weeklyAccountingFiguresArePinned.test.tsx`, club posted,
club incomplete, union periods) and passes unchanged. Markup changes are
class names and two wrapper divs; no handler, guard, hook, string, role or
aria changed and no class was removed.

The inventory now marks the Settlement body done, records the seven shells PR
#12312 converted, and names Agent Team's tab bodies as the next batch.
