# A fitted label ends on a ratio that was measured to fit

`production-mobile-lobby-chrome.spec.ts`, "compact rows open details and
filters stay at their original position", has failed on every full
post-deploy run since 2026-11-25 with "Open Registration must fit its painted
face".

Cause, read from the failing run's trace (run 46083886144): the label carried
`--fit: 0.6754` and its ink was 90.25px wide in an 89.16px face (1.09px over,
past the 1px tolerance). Rendered width moves in steps: the same label is 90px
wide at every ratio from 0.70 down to 0.6754 and 79px at 0.67. The fit loop
in `src/components/lobby/game-cards/useFitText.ts` corrected proportionally
(about 1.1% a pass for a 1px overflow) for four passes and then returned the
last corrected ratio, 0.6754, which it had written but never measured.

Fix: the loop returns only a ratio it measured to fit, or the floor. Each
pass steps down at least 2% until the measured width fits. Labels that already
fit on the first or a later measured pass get the same ratio as before.
Replaying both algorithms on the production DOM snapshot changes only "Open
Registration" (0.6754 at 90.25px over the face, then 0.6648 at 79.25px
inside it); every other filter label keeps its ratio. Pinned by
`tests/components/FitTextQuantizedWidth.test.tsx`, which fails on the old
loop.
