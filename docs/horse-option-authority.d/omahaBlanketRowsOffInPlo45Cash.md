# omahaBlanketRowsOffInPlo45Cash: Authority For The Live Switch

Built 2026-11-21 by EMERG lane BLANKET-AUDIT (PLO-OWNER lead-2) on the owner's order of 2026-11-20 3:28 PM Chicago ("THERE SHOULD NEVER EVER EVER BY ANY BLANKET RULES") and the lead's ruling of 2026-11-21 about 1:55 AM: an OFF row for a hidden default-on blanket rule is global and would change PLO6, which must not be touched. This file does not authorize switching the option on or publishing a list: switches and runtime settings are written only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash only (tables and Lightning), high only, one board, no bomb pot (`server/src/engine/HorseOmahaBlanketRowsOffInPlo45Cash.ts`). With the switch on, every blanket row on the declared list is passed false (its off path, the same one omahaNoCategoricalRules uses) before any rule reads it, in HorseLogic.decide and prepareOriginalReads, right after the game scope. The declared list is the engine runtime settings `horse.blanketRowOffInPlo45Cash.<option>` = 1 (live at each table's next hand, no cutover); it travels in the request as `omahaBlanketRowsOffList`.

Only members of OMAHA_BLANKET_ROWS_OFF_REGISTRY can be listed: the rules of omahaNoCategoricalRules' list that the rule-site register does not class priced. Lane BLANKET-AUDIT-2 (2026-11-21, owner 2:00-2:05 AM Chicago: every blanket rule goes off one at a time) added five named blanket rules that list does not hold (OMAHA_BLANKET_ROWS_OFF_EXTRA: omahaBigBetIsPotShare, omahaCurrentNutsRaise, ploSuitedAcesFourBet, v86PloOverhaul, v46Charts; none priced; an OFF row for each would also change tournaments or other games), made the scope fail closed (a decision state must say gameMode cash; the mode is never guessed from the blinds), and added a decision-level law for every member listed alone. A priced rule cannot be switched off through this option; any other name is ignored. PLO6, PLO8, hold'em, tournaments, bomb pots, hi-lo and multi-board hands run the same options object (byte-identical, decision-level law). It decides no action itself and reads nobody's identity.

Receipt: `omaha_blanket_rows_off_in_plo45_cash_applied` (one count per decision in which a listed row was passed off). Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only; scopable per game (`horse.omahaGameScope.omahaBlanketRowsOffInPlo45Cash`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/BLANKET-AUDIT.md: SPARRING bench at 6,000 pairs (CRITERIA-BLANKET-AUDIT-SYM-AMENDMENT-1, seed 20261121, heads-up and six-max) clears the removal of v74OmahaSemiBluffNeedsDraw and of the hidden four (ploPairedBoardFold, ploPairedBoardRiverCheck, omahaRiverNutRaiseOnly, omahaTurnSetPound). Neither has person evidence (v74: 0 person-live changes; hidden four: 3 changes from 1 person): each goes on as a watched removal with a rollback rule, one at a time, 60 minutes apart, after VERIFIER CONFIRM and the lead's write.

- Replay: NOT RUN (no audited-decision scorer row is recorded for this option; the per-member exact journal replays, Nov 20 journals, are recorded in the EMERG archive, BLANKET-AUDIT.md sections 2 and 9)
