# tests/test-scratch-never-uses-a-shared-drive-scaffold.law.test.ts

No test makes its mkdtemp scratch under /Volumes/SmarterWork/agent-work, a read-only compatibility scaffold on the Mac; scratch falls back to the runner temp, TMPDIR or the checkout's own node_modules/.cache.
