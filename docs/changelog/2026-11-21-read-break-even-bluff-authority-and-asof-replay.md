# readBreakEvenBluff authority file: AsOf-memory HVH48 replays and live 67-row check (2026-11-21)

- Added `docs/horse-option-authority.d/readBreakEvenBluff.md` recording the complete evaluation of `readBreakEvenBluff` (default OFF, no live switch row; **Evidence NOT MET: do not switch on**).
- Documented the distinction between the superseded pre-repair 2026-11-08 run (7 wins driven by an unread-opponent bug that failed 6 standing tests) and the post-repair 2026-11-08 run (41/54 cards inert, 13 inside 2 SE, 0 significant wins across all 54 cards and 20 exploiter cells).
- Recorded fresh 2026-11-21 live 67-row switch verification (`prod-switch-20261122T0336Z.json`, 3 seeds x 3,000 pairs): 100% inert (`+0.00 +/- 0.00`, `div = 0`, `0/0/0/0/0`) on both 6-max NLH human-calibrated and 6-max NLH mirror.
- Recorded fresh 2026-11-21 `AsOfOpponentMemory` (`76,098` retained `has_human` hands) audited replays across `22,031` real decisions: 100% inert on `HVH48-D` (`0/2,734`) and `HVH48-E` (`0/5,356`); engaged `break_even_bluff_priced` on `36/3,763` PLO5 (`HVH48-B`) and `27/10,178` PLO6 (`HVH48-C`) nodes with `0` action changes, `0` fixed, `0` newly wrong.
