# The Spin stall alarm reads the seated board (2026-11-11)

Incident f1b14fca (SpinFleetProducingNothing, 11:19Z). The stall arm read "no
Spin started for longer than the 8,400 s ladder envelope while boards sit
REGISTERING". The REGISTERING count included 33 empty boards that no horse will
ever sit at. The last-start clock also doesn't reset when the 03:00 Chicago park
cancels the night's boards. Fresh boards open at 06:00 Chicago, and the first
Spin after that is legitimately up to 140 minutes away.

Counting only seated boards (#10502) does not close the morning gap. Replayed on
production, `seconds_since_last_start > envelope and seated boards > 0` was true
from 12:04Z to 13:24Z on 2026-11-11.

The arm now reads the oldest seated board's own wait,
`poker_spin_unfilled_oldest_wait_seconds` (already emitted by fn_spin_fill_waits),
against the same envelope. Since the ladder went live it peaked at 7,612 s,
inside 8,400 s every hour. promtool scenarios C and D (boundary and `for: 5m`)
and the new J (the 11:19Z production shape, silent) pass, and the law forbids
the retired last-start arm.
