# Natural add-on counter and admission proof

The existing opt-in production spectator test now records DOM counter changes before any reload, checks every table against the committed tournament-wide add-on count, and reads the authoritative registration/rebuy decisions before, throughout and in the last second of the actual sixty-second window, then after closure. It retains the reserved observer identity, participation refusal, exact engine provenance and cleanup. No purchases or synthetic game events are introduced.

Validation: focused natural-add-on admission/workflow tests and Playwright discovery; the actual natural observation remains required after protected merge.

The first natural run witnessed real 0-to-30 DOM increments on unchanged pages and all six tables reached 30. Its element screenshot then waited for the animated countdown card to stabilize until the minute ended. Capture now uses the actual viewport with a five-second timeout, avoiding element-stability waits while retaining every behavioral assertion. The complete minute is re-observed on a subsequent natural tournament.

The request classifier now admits the actual deployed context-read RPCs and reserved-account session housekeeping. Previously it rejected balance, capability, exclusion, jackpot and time-bank reads, causing artificial errors during observation. Own-user presence is identity checked; login achievements remain explicitly suppressed because they can award currency, and this suppression is retained separately in evidence. Unknown RPCs, purchases and gameplay writes still fail the witness.
