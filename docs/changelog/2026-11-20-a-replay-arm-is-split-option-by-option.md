# A Replay Arm Runs The Options It Declares, Or Says So

**Found:** coordination inbox 2026-11-19 21:38Z (helper FACING-VALUE-2B, replaying 156 audited decisions). With a journal's full option set, the on and off arms came out identical; filtered option by option, the same options changed 105 of the 156.

**Cause.** `optionSwitchStatesFrom` refuses a set whole when any entry is a style option (those have their own switch) or a state the option does not support (`on` for an option that is off-only today). The live holder does that on purpose and raises its alarm. The replay source `optionSwitchSourceFromStates` handed such a set to the holder unchecked, nothing in a replay watches the alarm, and every option ran at its release default.

**Fix (server/src/engine/HorseOptionSwitch.ts).**

- `optionSwitchSourceFromStates` throws when this build refuses the set whole, naming every entry it cannot apply. A replay can no longer run an arm at the release defaults without saying so.
- `optionSwitchArmFrom(declared)` splits a declared or journaled set option by option: plain options it can apply, style options routed to the style switch, and every dropped entry with its reason. `optionSwitchArmStrict` throws when anything was dropped, so an arm whose declared difference cannot be applied is refused instead of scored.
- The live holder is unchanged.

**Law:** server/src/engine/aReplayArmIsSplitOptionByOption.law.test.ts (4 of its 5 cases fail on the previous source).
