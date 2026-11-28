# Two flaky unit tests wait for what they raced

Both turned Client Unit Tests shard 3 red on unrelated PRs (#12341, #12346) on
2026-11-28. Neither was a product defect; each test acted before the component
had finished what the test then measured.

- `tests/unit/ThemeSettingsModalHardening.test.tsx`, "repairs an open studio
  when the appearance realtime event was entirely missed". Opening the studio
  reads the theme row once, and once more when the appearance channel reports
  SUBSCRIBED (the catch-up read). The test swapped the row and then asserted
  that nothing was read for 2.1 s. On a loaded runner the catch-up read started
  after the swap and read the new row inside that window. Measured with the
  test instrumented under 12 parallel runs: 1 read at the swap in the failing
  case, 2 in every passing one, and no focus or online event involved. The test
  now waits for both opening reads before it swaps. 12 of 12 parallel runs pass.
- `tests/components/playerCommandMetricScope.test.tsx`: three tests fired a
  statistics broadcast before the page had subscribed to that channel
  (`Cannot read properties of undefined (reading 'onPayload')`), the race #12257
  fixed for the viewer channel. Each first broadcast now waits for the channel.
