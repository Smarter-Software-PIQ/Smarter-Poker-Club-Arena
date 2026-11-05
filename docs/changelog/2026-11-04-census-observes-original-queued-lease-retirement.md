# Census observes original queued lease retirement

A synchronous legacy census can delay the original ownership loop while it sleeps between passes. The retained-owner guard previously observed an expired manager only when a renewal Promise already existed, so it refused before the queued original timer could fence and retire that manager.

The guard now gives captured expired owners one bounded event-loop turn. It does not invoke renewal, expiry, stop or timer callbacks, and never accepts a renewed deadline. Success still requires the exact original GameServer retirement Promise to return true, exact registry removal and all existing child, bank, move, lease and custody proofs. Missing or already-cleared retirement receipts remain refused. The observation retains the existing one-second ceiling and remaining work/rollback reserves.

Two regressions use the actual pinned EED renewal loop and original sleep timer, delayed by synchronous work: original retirement succeeds, while registry replacement refuses before checkpoint writes. All prior 69 historical cases remain required. Production installation and live evidence are separate.

Hosted qualification exposed a fixture race: a fixed 20ms lifecycle-job release could run before the guard captured the original retirement receipt. The fixture now releases that held job only after the exact original Promise is observed, with a one-shot assertion and delayed setup regression. It still executes the original renewal loop and timer; no runtime budget changes.

The read-only recovery observer also pins the exact updated seal/transaction producer pair. Every previous pair remains accepted, and historical tests read immutable predecessor bytes instead of mixing old transactions with the new seal.
