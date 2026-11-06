# Preserve serialized production browser coverage

Run 42293553734 exhausted the 80-minute client job deadline before report validation and fixture cleanup. Its surviving step log reached case 582 of 737 at 22:33:21 UTC. Increase the bounded job budget to 120 minutes while preserving single-worker shared-account execution, all test deadlines, retries, validators, and cleanup guards.

The same run exposed a second stale category assertion: repeated Cash Games selection expected collapse although the component keeps the selected family open. Assert the current cash tablist remains visible with its exact four tabs. No product layout or runtime behavior changes. Earlier failures 1 and 2 were unavailable because the cancelled runner retained only log lines 1027–2026 and did not upload its report.
