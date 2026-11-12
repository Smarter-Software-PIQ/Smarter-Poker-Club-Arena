# A release-control change no longer skips the daily window migrations (2026-11-12)

On 11-10, 11-11 and 11-12 the daily reservation's `cutoff` step refused the engine because release controls
changed during the reservation (correct), and `window-migrations` was skipped with it because it required
a successful detect job. Five window migrations waited through three daily breaks. `cutoff` now writes
`install_sha` before the authority comparison, and the installer runs on that source when detect wrote it.
The engine offer (`selection`, `signal`) never reads it. The installer's own freeze, ancestry and timing
checks are unchanged. Evidence: `docs/production-alerts/evidence/release-window-install-skipped-on-release-control-change/`.
