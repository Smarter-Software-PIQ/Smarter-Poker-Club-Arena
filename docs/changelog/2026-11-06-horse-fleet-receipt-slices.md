# Bounded Horse receipt coverage

The existing read-only tournament inspector accepts `reference_cases_json` version 9 (`probe: "fleet_slice"`). This addresses the missing fleet observation route without changing engine decisions, database state, credentials, publication, or the existing version 8 bounds.

```json
{
  "version": 9,
  "probe": "fleet_slice",
  "sourceRelease": "<40 lowercase hex>",
  "expectedInstanceId": "<observed engine instance>",
  "window": { "startUtc": "2026-11-06T15:00:00.000Z", "endUtc": "2026-11-06T15:10:00.000Z" },
  "roster": {
    "digest": "<64 lowercase hex of retained external roster/query receipt>",
    "total": 1000,
    "horseIds": ["<actual Horse UUID>"]
  },
  "cases": [
    {
      "handKey": "<SHA256(tableId:handNumber:leaseGeneration)>",
      "tableId": "<UUID>",
      "handId": "<UUID>",
      "handNumber": 123,
      "leaseGeneration": "<UUID>"
    }
  ]
}
```

The roster denominator is externally supplied, never certified by the inspector. Obtain its actual IDs and count from the existing read-only database route (`profiles.is_horse=true`, preserving eligibility/status separately). Accepted-hand selection comes from `hand_atomic_commits` joined to `hand_history` on all three original coordinates, with a fixed database `committed_at` window and complete query/pagination receipts. Never substitute current table seats for historical participation. The input digest binds that external evidence without claiming to verify it.

The inspector's window filters retained engine record/decision timestamps. Those are a different clock from database `committed_at`; `crossClockCutoffVerified` stays false. A boundary exclusion or unavailable journal cannot prove no accepted database action occurred. The fixed source/image/container checks and expected instance remain required before and after the read.

Each call carries at most 64 unique Horse IDs and six unique hand coordinates within the unchanged 8KiB input bound. Every retained Horse-policy action for the selected IDs is joined to its original decision, execution and accepted hand. Whole-hand reconciliation must pass. Private payloads never cross output. Each hand/Horse row exposes counts, exact context partitions and receipt-chain digests, distinguishing accepted bets, checks and all-ins in qualifying river contexts. An empty row set leaves every supplied Horse unobserved. `observed` means the selected action records were inspected, never that the supplied population adopted a strategy.

A 10-second analysis budget and 32KiB metadata report bound sit inside the existing child/host limits. Unfinished hands/actions, failed joins and unavailable exact memory stay explicit. For finite external aggregation, deduplicate by `(sourceRelease, expectedInstanceId, window, handKey, horseHash)`; conflicting repeats are unknown, never additive. Keep each externally selected hand in the coverage denominator even when the journal is missing. The selected Horse hashes include IDs with no observed actions, so a dormant Horse cannot disappear from the denominator. No internal scan, scheduler or replay is introduced.

Exact shared-memory evidence requires an original v2 observer context with matching public rule domain and the installed receipt validator. Legacy contexts are unavailable, not relabelled. The current pre-consumer runtime refuses v2; future support is inherited only from the separately delivered exact-memory consumer. Positive future-version adapter tests exercise projection plumbing and real existing chronology/identity validation, not proof that the pending consumer is already installed. Restart cache hydration remains bounded and best-effort; neither worker READY nor stored database profiles alone prove a Horse consumed those profiles.

Version 8 also projects a closed subset of retained decision/execution policy ownership, Omaha variant receipt and outer policy graph. Unknown enum/reason values are unavailable. No cards, amounts, features, arbitrary strings, equity interpretations or reference-internal causal branch claims are exported. This separates an observed outer policy intervention from an unexplained reference check.

Validation uses the existing real original-record regression fixture, including two actor chains in one hand, missing/conflicting receipts, clock boundaries, exact-domain mismatch, legacy refusal, bounded partial results, sanitized output and fixed transport wiring. No policy qualification, GTO/EV verdict, universal adoption or production dispatch is implied.
