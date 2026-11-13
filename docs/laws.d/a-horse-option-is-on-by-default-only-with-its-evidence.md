# server/src/engine/HorseDefaultOnNeedsEvidence.law.test.ts

A Horse decision option that HorseLogic reads as on by default (`opts.x !== false` or `opts.x ?? true`) must either have been on by default when the law was written or carry `docs/horse-default-on.d/<option>.md` naming its pull request and answering the eight rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. Two PLO6 changes (#10626, #10628) were merged on by default on a mechanism alone and withdrawn hours later; this stops a third. An option read as `=== true` is an opt-in arm and is not affected.
