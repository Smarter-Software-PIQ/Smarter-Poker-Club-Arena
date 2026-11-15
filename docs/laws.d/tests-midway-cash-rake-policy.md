# tests/midway-cash-rake-policy.law.test.ts

Owner instruction 2026-10-21: every Midway Union cash game has a maximum full cap of 2.5 BB, standalone clubs inherit that default and may customize rake, and BBJ remains unchanged. Pins browser/engine scope parity, both dealing paths, frozen per-hand receipts, and native CI qualification. Historical unscoped stake replay remains available for pre-policy hands.

November 14, 2026: the full Midway chip rake is at most 10% and the lower of 2.5 BB or 12.5 chips per hand. Existing lower rates, caps and player-count reductions still apply. The new client uses the absolute ceiling when the serving engine advertises cashRakePolicyVersion 2.

November 15, 2026: all Midway fixed-limit chip cash games have a 5-chip maximum at every stake, including fixed-limit Holdem and four-, five-, six-card and hi/lo Omaha. The other Midway chip cash games retain the 12.5-chip maximum. The client reads version 3 from the serving dealer before quoting this change.
