# Preserve the owned fixture browser across sequential certificates

The continuity and seat-move checks use the same disposable account but invoke Playwright global setup separately. Each fresh context previously generated a new browser device token. The account's legitimate same-device/new-device prompt then blocked the second check.

Global setup now binds a stable browser token to the maintained disposable account record, authenticated account ID/email and exact app origin. It seeds only that token into a fresh context. It never copies another session, seeds the enrolled-device marker, clicks a device takeover, hides the prompt or changes authentication rules. Ordinary accounts do not use this path.

Setup requires the app to write a fresh enrollment marker through its normal claim flow, and verifies the current account, token and origin before sharing storage state. Unknown enrollment or mismatched fixture ownership fails the setup. The regression runs the real enrollment consumer twice: empty fresh contexts reproduce the choice prompt; the same owned fixture token enrolls on both sessions without it.

This changes only the certification harness. Production gameplay, settlement and device authentication remain unchanged. Live certificate verification remains required after protected integration.
