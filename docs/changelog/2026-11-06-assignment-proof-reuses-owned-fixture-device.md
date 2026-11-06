# Assignment Proof Reuses Its Owned Fixture Device

Production browser run 42213446474 passed the Data privacy boundaries but its assignment proof opened the same reserved account in fresh contexts without the existing deterministic browser identity. The legitimate device-choice dialog blocked Save, then the later global setup could not enroll its different fixture browser.

The assignment harness now uses the same validated account-and-origin fixture helper as global setup and observes the app’s normal enrollment before interacting. No enrollment marker is seeded, no login guard is bypassed, and all existing assignment, privacy, and cleanup assertions remain. The regression exercises repeated assignment contexts and the next certificate through the real enrollment consumer.
