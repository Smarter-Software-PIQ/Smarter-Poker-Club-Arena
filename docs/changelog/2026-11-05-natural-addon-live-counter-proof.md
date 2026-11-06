# Natural add-on counter and admission proof

The existing opt-in production spectator test now records DOM counter changes before any reload, checks every table against the committed tournament-wide add-on count, and reads the authoritative registration/rebuy decisions before, throughout and in the last second of the actual sixty-second window, then after closure. It retains the reserved observer identity, participation refusal, exact engine provenance and cleanup. No purchases or synthetic game events are introduced.

Validation: focused natural-add-on admission/workflow tests and Playwright discovery; the actual natural observation remains required after protected merge.
