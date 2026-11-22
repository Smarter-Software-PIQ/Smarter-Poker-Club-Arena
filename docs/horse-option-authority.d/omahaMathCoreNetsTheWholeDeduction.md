# omahaMathCoreNetsTheWholeDeduction: Authority For The Live Switch

**INERT (lane CORE-FIX-1, PLO-OWNER lead-3, AUDIT-A item 11, Nov 21 2026).** This option changes no decision. Since lane CORE-POOLED-4 the core nets every pot of the whole platform deduction by default (`omahaMathCoreState`: `wholeDeduction` is read by nothing), so on and off price and decide identically; the law `OmahaMathCoreCoreFix1.law.test.ts` ("CORE-FIX-1: the option changes no decision") proves it on generated in-scope PLO4/PLO5 decisions on every street. It stays in the ledger and rule sites only because the switch lists name it; retiring the name needs a switch-list migration. A switch row for it turns nothing on. The text below is the original record.

Built 2026-11-20 by EMERG lane RAKE for the PLO-OWNER lead. This file does not authorize switching the option on. Switches are made only by the lead, through the delivery path. It records what the option is and what was measured.

## What It Does

Nothing without `omahaMathCore`. The math core prices every action as equity times the pot the winner takes, less the chips added; the pot the winner takes is `rakeNet` (`server/src/engine/omahaMathCore/OmahaMathCore.ts`). Today `rakeNet` takes the percentage up to the table cap after the flop, never the jackpot drop, and nothing on any preflop line. With the option on (`omahaMathCoreState`, third argument):

- the cap is the cap of the dealt-player tier (the controller's own ladder: heads-up half, and the three-handed rung where the table has one);
- the fixed jackpot drop is deducted where it is collected (enabled, enough players dealt);
- a preflop line that reaches a flop is netted of both; a preflop pot won because everyone folded still pays nothing (no flop, no drop).

Public table rules only. PLO6 is outside the core. Default OFF in source (read `=== true`).

## What Was Measured

See archive repairs/EMERG/RAKE.md.

- Realised, 5 weeks: a Horse preflop call that sees a flop pays 0.46 to 0.83 big blinds of rake and drop per decision from its own awards (cold call 0.46 to 0.80, big blind call 0.63 to 0.83, first-in open 0.63 to 0.78). The core prices every one of them at zero today; lane PREFLOP-AUDIT found the core's caller realization does not reproduce the measured cold-call loss for that reason.
- Exact journal replay of the core with the option: not run at the time of the commit (a full test gate held the machine; the core's preflop component is itself off).

Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the realised figures are in archive repairs/EMERG/RAKE.md)
