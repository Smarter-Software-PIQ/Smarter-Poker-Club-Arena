# 2026-11-07 - A gesture made before the account preference arrives is kept

## What failed

Post-deploy run 42370089738, `production-club-members.spec.ts` at 375px: the
page stayed on Advanced for 45 s after the Simple button was tapped.

## Root cause

`usePlayerPreference.select` returned early when the chosen value equalled the
value on screen. On a device with no cached choice, the screen shows the
default (Simple) while the account row (Advanced, saved earlier from another
device) is still being read. Tapping Simple was therefore a no-op: no
revision bump, no intent. The account read then arrived and set Advanced,
because nothing said the player had chosen since. A real player sees the same
flip: they tap Simple and the page turns to Advanced a moment later.

## Fix

The hook records when the account value for the current scope has been read.
Before that, a gesture that matches the shown value still claims the selection
(cache, intent, debounced save), so the late read cannot replace it and the
account is updated to what the player chose. After the read, re-selecting the
shown value stays a no-op with no write.

`tests/unit/usePlayerPreference.test.tsx` covers both cases; the first fails
without the fix.
