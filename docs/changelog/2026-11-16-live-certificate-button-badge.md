# Live certificate validates the button-wait badge

The production witness treated every engine sit-out flag as a voluntary sit-out
unless the player waited for the big blind. The client also supports the engine's
`is_waiting_for_button` hold, which renders `seat-waiting-button-badge` with higher
precedence. The retained production trace showed that correct badge while the
witness reported a missing sit-out badge.

Project the button hold and observe its exact visible badge. Keep all avatar,
seat, badge-loss, reconnect and durable-occupancy checks. Regression cases pin the
engine projection and actual DOM reader, reject replacement or missing badges,
and retain the hold across hands and reconnect. Both projection and paint tests
fail against the previous witness.

Separate hosted WebKit failures exited WPE with status 1 without a fatal signal or
kernel OOM report. Retain the owned browser's native stderr in the existing live
job so its next normal run supplies the missing termination reason. This is
diagnostic evidence, not a claim that those browser failures are fixed. Required
test assertions, deadlines, projects, retries and certification gates stay intact.
