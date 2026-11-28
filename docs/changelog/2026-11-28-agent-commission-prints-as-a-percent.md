# An agent's commission prints as a percent, not as the stored fraction

`AgentService` validates `commission_rate` as a fraction from 0 to 0.7, so a
40% agent arrives as `0.4`. Two places printed it with a "%" after it: the
Agent Team Hierarchy tree (`AgentTree.tsx`) and the club page's agent list
(`ClubDetailPage.tsx`). An operator read a 40% agent as "0.4%". Agent Team's
own detail view and export already multiplied by 100.

- `formatAgentRate` now lives beside the parser that defines the scale
  (`src/services/AgentService.ts`) and both print sites use it ("40.0%").
- `tests/unit/agentRatesPrintAsPercent.test.ts` pins the format and refuses a
  raw `{...commissionRate}%` or rakeback-rate print anywhere in `src`. The
  add-agent form, which holds whole percents and divides by 100 when it saves,
  is the one exception.
- `tests/components/agentTeamTabBodiesArePinned.test.tsx` (from #12319) used
  whole-percent fixtures (35, 20, 12.5), a scale the service never returns,
  which is why it recorded "35 %" as correct. Its fixtures are now the real
  fractions and its pins read "35.0%", "20.0%" and "12.5%". This is a
  deliberate change to pinned output.
- `tests/components/AgentTreeWalletBalance.test.tsx` uses the real scale and
  asserts the percent.
- The tree's load failure now reads "Failed To Load Agent Hierarchy" (Title
  Case), and its pin follows.
