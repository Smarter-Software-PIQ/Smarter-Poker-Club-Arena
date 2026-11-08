# 2026-11-07 - A Dropped Font Download Is Retried

Publish Club Arena run 42418194250 (commit 8bc49c9, 21:59 UTC) failed in `build-and-store` with `[self-host-fonts] FAILED: fetch failed`. `scripts/self-host-fonts.mjs` fetched Google's css2 stylesheet and each woff2 with one bare `fetch()`, no timeout and no second attempt, and the origin requires `dist/fonts/fonts.css` in every release, so one dropped connection cost the whole publish. A scan of every failed Publish Club Arena run since 2026-10-24 (105 of more than 1,000 runs) found this as the only font-step failure in that period.

## Fix

`scripts/lib/fetch-font-input.mjs` fetches every font input with a 20-second timeout and up to four attempts (waits of 2, 5 and 10 seconds). Only transient failures are retried: a network error, a timeout, 408/429/5xx, or a body that arrived cut short or malformed. A definite refusal (another 4xx, or a redirect) fails at once. Nothing ships unverified: the stylesheet must contain `@font-face`, every font must start with the woff2 signature, and an uncompressed body must match its declared length. The bytes, names and receipt are unchanged, so the append-only font pool and the runtime retention proof see exactly what they saw before.

## Why the fonts are not committed to the repository

The sealed runtime receipt (`client-runtime-font-inputs.json`) is defined as Google's bytes at Google's URLs, and retention re-fetches them to prove a bundle reproducible (`verifyFontInputs`). A committed snapshot would drift from Google the first time Google ships a new font version, and every retention proof after that would fail. Retrying keeps that contract.

Law test: `tests/a-dropped-font-download-is-retried.law.test.ts`.
