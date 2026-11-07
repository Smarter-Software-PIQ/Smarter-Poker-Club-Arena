# Club Create Certification Reads Again

`Club Create Certification` failed 27 of its last 30 runs (2026-11-06/07). No issue tracked it and no successes remained in the window, so the check had no reader (CLAUDE.md 10.83). There were two causes, both outside the product.

1. **Nothing was published, and the certificate still demanded a bundle.**
   - When a merge changes no client code, the publisher decides no publish is needed. It builds no `club-arena-dist-*` bundle and writes no retained-runtime receipt.
   - `club-create-publication-mode.mjs` correctly refuses such a run ("Exactly one published bundle or one retained runtime receipt required"). Certifying against it is the defect: there is no Create Club revision to certify.
   - `post-deploy-e2e.yml` already treats this exact provider shape as a non-verdict (#9798).
   - A new `publication` job now reads the source run's jobs. `nothingPublished()` stands `certify` down only for that shape, with a NON-VERDICT summary:
     - `publish-needed` and admission succeeded;
     - build, client tests and both production callers were skipped with no steps run.
   - Any built bundle, started production, failure, unknown or duplicate job, or partial page still certifies or refuses exactly as before.
   - Checked against the last 37 successful publisher runs: the 2 with no artifact stand down, and the 35 with a bundle certify.

2. **`ubuntu-latest` now resolves to Ubuntu 26.04, which has no Playwright Chromium build** ("Playwright does not support chromium on ubuntu26.04-x64").
   - Every certification that reached the browser install failed.
   - The Playwright jobs here, in `cashier-ui-proof.yml` and in `diamond-visual-baseline.yml` (whose latest run failed the same way) are now pinned to `ubuntu-24.04`. That matches `post-deploy-e2e`, `lobby-ui-proof`, `rabbit-hunt-certification`, `session-hand-stats-proof` and the CI shards.

Tests: `tests/operations/club-create-publication-mode.test.mjs` covers the real job shape of publisher run 42346558084, seven refusing variants, and the workflow wiring.
