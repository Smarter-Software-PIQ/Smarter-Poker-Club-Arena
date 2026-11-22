# server/src/benchmark/AScriptedSeatWagerIsInsideTheLegalRange.law.test.ts

A scripted benchmark seat never asks the street engine for a wager the engine refuses: its wager is rounded to a whole chip before it is clamped to the legal range, so a pot-limit cap that is a fraction of a chip is never rounded past, checked against the engine's own validator on random states and on the four states recorded on the development seed.
