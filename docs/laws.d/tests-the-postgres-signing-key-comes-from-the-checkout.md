# tests/the-postgres-signing-key-comes-from-the-checkout.law.test.ts

Every workflow that adds the PostgreSQL apt repository installs its signing key from the checkout, `.github/pgdg/apt.postgresql.org.asc` (fingerprint `B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8`, sha256 `0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76`), never by downloading it from `www.postgresql.org` at run time. The download failed with TLS EOFs in at least 11 jobs on 2026-11-07 before any test ran; the committed key is byte-identical to what the download returned.
