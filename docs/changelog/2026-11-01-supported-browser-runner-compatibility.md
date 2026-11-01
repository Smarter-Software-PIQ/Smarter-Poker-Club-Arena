# Preserve browser delivery on its supported hosted operating system

Actual current-head CI41257108915 failed before browser assertions because ubuntu-latest resolved to Ubuntu26.04, which pinned Playwright1.58.0 refuses. Reuse the existing runner correction57e8375c17ab705b638649f9927b25a932f45891: existing browser/build/accounting jobs use standard Ubuntu24.04, and the existing post-deploy browser jobs use the same supported image. Official Playwright1.58 supports Ubuntu22.04/24.04. No browser version, provider, command, matrix, assertion, timeout, permission or cleanup changes.

The source correction is reused without its parent branch's unrelated performance/routing changes. Current source-binding conflicts retain this branch's prior audit history and bind only actual integrated CI/fixture-contract bytes, explicitly recording no new execution or historical qualification restamp. Existing exact runner contracts retain their whole-job command fingerprints; their expected operating-system fields change together.

Current-head protected checks and the original affected live browser proof remain required. An operating-system pin is not a passing browser result or production delivery.
