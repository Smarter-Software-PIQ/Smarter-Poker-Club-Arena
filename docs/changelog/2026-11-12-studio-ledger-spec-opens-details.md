# Table Studio production spec opens the configuration ledger

#10290 turned the Table Studio "Current Table Configuration" region into a collapsed
`<details>` with no aria-label, and `production-customization-realtime.spec.ts` kept
selecting the old label, so Post-Deploy E2E failed from 11-09 (alert 371597, item 3).
The spec now opens the ledger by its summary. A new law requires every production
spec's aria-label selector to name a label the client source renders.
