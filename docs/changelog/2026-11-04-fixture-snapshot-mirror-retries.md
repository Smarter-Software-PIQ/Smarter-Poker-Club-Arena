# Native fixture image survives snapshot mirror outages

PR #9486's required native fixture check failed four times on November 4 at the image build, each time because `snapshot.debian.org` answered `503 No healthy backends` or `504 Gateway Timeout` while downloading pinned packages (PostgreSQL client, OpenSSL, X11/font libraries for Chromium). No assertion, service or source behavior was involved.

The fixture Dockerfile now runs the existing `apt-get update`, pinned `apt-get install` and Playwright Chromium dependency install as one unit with up to six bounded attempts (30–150 second pauses) and raises APT's per-file retries from 3 to 10. Already-downloaded archives are reused, the same pinned snapshot, package versions, signature checks and `check-valid-until` scope are unchanged, and a sixth consecutive failure still fails the build with exit code 100. A stubbed shell check confirmed success on the first or a later attempt and failure after six.
