## Description

<!-- Brief description of what this PR does -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Performance improvement
- [ ] CI/CD improvement
- [ ] Documentation update

## Checklist

- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] Build succeeds (`npm run build`)
- [ ] Tested locally on smarter.poker
- [ ] No console errors introduced
- [ ] No new `alert()` calls (use toast system)
- [ ] Supabase queries use `.maybeSingle()` not `.single()`

If this PR changes an engine launch command, certificate, window or recovery procedure, update the [daily launch runbook](../PUBLISHING.md#backup-and-daily-engine-launch) and verify its affected instructions against the workflow.

## Screenshots

<!-- If UI changes, paste screenshots here -->

## Visual Release Gate

- [ ] Not a visual change
- [ ] Desktop and mobile renders were shown to the user and explicitly approved before auto-merge was enabled
