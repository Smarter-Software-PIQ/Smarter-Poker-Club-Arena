# The Push Ask Reaches Players Who Skipped Phone Verification (2026-11-05)

The Tournament Arena relaunch push reached 3 devices out of 128 players. Most
players had never turned notifications on, and 88 of the 128 had never been
asked: both the World Hub and Club Arena only showed the notification ask to a
player with a VERIFIED phone, and those 88 had tapped Skip on the phone step.

The ask still waits for the first-login phone step so it never stacks on the
signup welcome, but the step now counts as settled when the phone is verified,
the player tapped Skip this session, or the account is past its first day
(`src/lib/pushAskGate.ts`, same rule as World Hub
`src/lib/push/pushAskGate.mjs`). The ask's cadence in `pushNudgePolicy` is
unchanged: at most one a day, a cool-down after Not Now, never when blocked,
already on or turned off.

Tests: `tests/components/FirstRunPushPrompt.test.tsx` adds the skipped and
past-day-one cases; the existing "waits for phone verification" case still
holds for a brand-new unverified player.
