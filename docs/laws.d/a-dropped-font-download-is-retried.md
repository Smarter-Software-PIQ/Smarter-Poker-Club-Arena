# tests/a-dropped-font-download-is-retried.law.test.ts

2026-11-07: the build's self-hosted font step fetches every Google Fonts input with a timeout and up to four attempts on a bounded backoff, retrying only transient failures (network error, timeout, 408/429/5xx, a cut-short or malformed body) and failing at once on a definite refusal. Nothing ships unverified: the stylesheet must contain @font-face, every font must carry the woff2 signature, and an uncompressed body must match its declared length. Publish run 42418194250 lost a release to one transient fetch failure.
