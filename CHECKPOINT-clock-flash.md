# Legacy turn control flash, November 1, 2026

Owner: this chat (01a19915). Scope: remove the small legacy stopwatch and countdown shown in the two supplied screenshots before the updated display. Client only; no engine, database, financial, or maintenance changes.

Checkout: /Volumes/SmarterWork/agent-work/shared-capacity/clock-flash-01a19915/ca
Branch: codex/remove-legacy-clock-flash
Base/live baseline: b4453ab6e58bced3a99d90dfe8312d7b70183c65
Evidence: /Volumes/SmarterArchives/agent-evidence/clock-flash-01a19915

Current canonical policy reader emitted 2026-11-01T21:48:14.065Z, policy 2.9, manifest 7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52. All four canonical policies read, including the initially truncated operating law read separately in full. Repository AGENTS.md, CLAUDE.md, AGENT-PLAYBOOK.md, PUBLISHING.md, deploy-paths and console skill read. Canonical comparison passed. Storage guide read; shared-capacity is mounted /dev/disk5s1 with 694 GiB free. Configured authenticated gh access verified without reading credential values.
Policy hashes: owner 73c17bed0bc531031283fa33c0b45d4546869166beef9d714bcfe76cfcdb9fdb; operating a8bc3c04dce3354ebdd51a89c0b7d715af3344edcc794d33f6b3ad64506961d5; hardening d5fc451ce5caf6d6b5e64597a13883e1246581678fe53c962339d0a66136993e; index adce89c3f838f2f373cd504a00329d53906404d1dd42a647f672af6c16f95555.

Cause: TablePage still conditionally mounted a second control-strip containing a compact time-bank button and ActionClockSeconds. This is the exact DOM/class pair corresponding to the screenshot. Remove this render branch and its unused icon/clock imports. Keep the seat action clock, time-bank balance HUD, warnings, automatic bank handling and Pineapple decision bank handler unchanged. Update the existing pre-action regression contract to forbid the retired strip while pinning the retained consumers. No artificial delay or CSS hiding.

Acceptance: old strip absent for first render, turn transitions and rerenders; maintained clock/balance consumers connected; affected unit/source checks and compiler pass; normal hooks; required hosted checks, protected squash merge, publisher success, both public build-info identities and affected browser proof. Screenshot is owner-provided evidence; safe local temporal reproduction/live behavior remains to be verified. No success claimed from source alone.

Status: implementation prepared; private locked dependency install running. PR/publication not yet submitted.

Owner added Bet Pot sizing (second screenshot, hand #53371153, 300/600, displayed pot 7,205 and bet 7,500). Reproduced arithmetic at the maintained preset: blind-grid ceil(7205 / 300) \* 300 = 7500. Four new regression cases fail before the fix (exact unopened pot, facing bet raise-to, off-grid stack cap, off-grid minimum). POT now uses the wager unit and actual legal bounds, preserving fractional presets and manual slider behavior. No production wager or financial write used for verification.
Initial clock checks: 60 tests passed in four focused files; compiler passed. Remaining final candidate checks cover added sizing scope.

Final validation reading: canonical policy reader freshly emitted full unchanged 2.9 policies at 2026-11-01T21:52:39.150Z (same manifest/hashes above). Scope is now both owner-requested client fixes. Private npm ci completed; focused sizing suites 87 passed, component click/display/submit test passed (6 tests in file). All four copy gates passed. Final tsc and isolated Vite build passed. Browser temporal observer added to the existing enforced live-turn replay to detect even briefly inserted legacy DOM through cold mount and street changes. Final browser and normal pre-push contract checks in progress.
