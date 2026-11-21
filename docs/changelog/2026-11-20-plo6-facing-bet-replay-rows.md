# plo6FacingBetIsPriced: the real Replay rows (2026-11-20)

Documents only. No option, no migration, no code, no switch row. No database was read or written. `plo6FacingBetIsPriced` stays OFF and Evidence NOT MET.

## What was run

On the operations Mac, in the coordinator's own directory (`/Volumes/SmarterWork/agent-work/shared-capacity/coord-plo6-replay-01UxDLnH/`), against the HVH48 auditor C PLO6 set (`hvh48-audit-01TLQer7J/C`, read only):

1. The scorer of PR #11533 (commit 17902e71ecf) emitted the audited nodes: 11,558 placed, 0 not placed.
2. A copy of the auditor's harness (`hvhC_replay.ts`; the original is untouched) re-decided every node with `HorseLogic` from the same checkout, at seeds 1, 7 and 42, one replay file per seed, twice per node: arm off (the audit day's switch set, `plo6FacingBetIsPriced` off) and arm on (the same set, the option on). Both sets are declared on the replay's meta line and accepted by today's registry. The seven style options of the audit-day set belong to the style switch, not the option registry: they are handed to the brain as that day held them and reported under `sanitized`, not declared. The copy keeps only voluntary actions in `actionHistory` (the open `HorseComplaintReplay.stateAt` forced-post defect); a seed 1 check with the posts kept changed the result by one node.
3. The scorer scored each seed with `--line on --row on`.

## Result

- Replay: fixed 93; newlyWrong 80 (seed 1); fixed 94; newlyWrong 82 (seed 7); fixed 95; newlyWrong 78 (seed 42). The rows are in `docs/horse-option-authority.d/plo6FacingBetIsPriced.md`, unedited.
- Base reproduction: 7,614 / 7,655 / 7,651 of the 10,178 replayable decisions (the 1,380 `unpriced` rows carry no hole cards in the audit and are errors, never judged); postflop about 86 to 87%.
- No change is illegal or refused by the receipt validator.

## Why it stays NOT MET

The README bar (newlyWrong at or below fixed in every run row) is met on all three seeds. The file's own activation section also requires its league card (`plo6_facing_bet_is_priced`), which is declared and not yet dealt, so the status stays Evidence NOT MET. The newly wrong count (about 80 per seed) sits mostly in flop and turn folds made calls, where the verdict-only scorer counts any change away from a decision the auditor found no mistake in.
