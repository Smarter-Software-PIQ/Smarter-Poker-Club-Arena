# Post-deploy browsers use a supported hosted image

Post-deploy run 41267912641 failed before browser tests because ubuntu-latest selected Ubuntu 26.04, unsupported by locked Playwright 1.58.0. Pin the five jobs that install Playwright browsers in this workflow to ubuntu-24.04, consistent with the existing pre-merge browser jobs.

The regression test discovers the browser-installing jobs and requires the supported runner. Browser versions, assertions, timeouts, production provenance and cleanup remain unchanged. Use the existing closed client_navigation recovery mode after protected merge for the scoped Chromium and WebKit navigation/Details verification; no client republish or engine replacement is needed.
