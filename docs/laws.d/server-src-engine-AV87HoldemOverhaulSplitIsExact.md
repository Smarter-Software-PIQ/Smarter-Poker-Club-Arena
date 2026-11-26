# server/src/engine/AV87HoldemOverhaulSplitIsExact.law.test.ts

All 14 V87 Hold'em postflop blanket sub-rules are decoupled from `v87HoldemOverhaul` onto independent default-ON `v87*` sub-flags with 100% bit-identical default-ON behavior, preserved `v87HoldemOverhaul: false` full-umbrella compatibility, strict single-flag isolation, and zero PLO4/PLO5/PLO6 impact.
