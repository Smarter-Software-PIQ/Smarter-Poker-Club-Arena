# Random Horse tournament registrations

Horse MTT registration counts and timing now vary by tournament. Each random tournament UUID seeds a stable plan, so discovery, registration rechecks, retries and engine restarts agree. The planned field retains guarantee coverage and adds random headroom; approximately40-60% arrive before the start and the remaining planned entrants arrive throughout late registration. Individual arrival thresholds and curve shape vary by event and phase.

The existing T-10 purchase gate, capacity, funding, duplicate, lifecycle and late-registration checks remain authoritative. Existing entries are never removed to meet a plan. A round total can still occur by chance. A bounded slice accounts for the steepest closing curve, avoiding a missed prestart target or an unbounded catch-up burst.

Verification covers variation across events, restart stability, monotonic arrivals, prestart/late boundaries, capacity and safe slice sizes. Live publication evidence is maintained in CHECKPOINT-random-horse-entry.md; source delivery alone does not establish runtime adoption.
