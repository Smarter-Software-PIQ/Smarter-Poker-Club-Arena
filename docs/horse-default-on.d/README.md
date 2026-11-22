# Evidence Files For Horse Options That Are On By Default

One file per option, named `<option>.md`, where `<option>` is the HorseDecideOpts name that HorseLogic reads as on by default: `opts.<option> !== false`, `opts.<option> ?? true`, `opts.<option> === false`, or `(opts.<option> ?? opts.<parent>) !== false`.

`server/src/engine/HorseDefaultOnNeedsEvidence.law.test.ts` fails a pull request that turns an option on by default without its file. Options already on by default on 2026-11-13 are listed in that law and need no file. An option read as `=== true` is an opt-in arm and needs no file.

A HorseMind process switch (read outside the decide options, for example in observe) whose source default `export const <NAME>_DEFAULT` is `true` needs a file too, named by the switch in lower camel case: `FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT` -> `fixedLimitBetsAreNeverProbes.md`. The same law checks it.

The law reads HorseLogic.ts as text. It does not see a default applied through a helper function, behaviour keyed on `=== undefined` or `!== true`, an alias, a destructuring default or another file, so a reviewer still has to look for those. A comment after code on the same line that quotes a default-on read is counted as a read.

## What A File Contains

A reference to the pull request (for example `#10615`) and one section per row of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md), each with a real answer or a link to where the answer is:

```
# <option> (#<pull request>)

## Mechanism
## Input fidelity
## Value
## Continuation
## Reach
## Scope
## Visibility
## Limits
```

Each row states its status on a line of its own, directly under its heading: `Status: MET`, `Status: NOT MET` or `Status: NOT APPLICABLE` (say why under it). A row that is `NOT MET` in a file for an option that is on by default also carries, in the same row, `Owner authority: <retained file> sha256 <hex>`: the retained owner instruction that allows it to ship on with that row unmet. Without it the option ships as an opt-in arm (`=== true`).

The law checks that each section exists, is not empty and states its status, and that an unmet row cites the owner's authority. It does not judge whether `MET` is true; that is the reviewer's judgment.
