# Small fleets are still dealing

Incident fd614614 fired because SLOHandsAreNotBeingDealt still required the September estate to complete one hand per second. At 05:03 UTC November 11 the rate was 0.592982, 48 tables had timing samples, worst progress age was 15.316 seconds and no table was stalled. Independent production hand history recorded 1,349 hands across 50 tables during 04:59–05:09 UTC.

The no-dealing objective now requires zero completed hands over its five-minute rate window with live dealable capacity for ten minutes. Historical timing samples no longer establish current capacity. Existing capacity-normalized throughput, relative throughput and individual-table stall objectives remain unchanged. Maintenance and owner park guards retain their scope, with explicit label-independent maintenance matching.

Seven real Prometheus fixture scenarios in the existing required SLO runner cover low volume, a single advancing table, exact pending/recovery, no capacity, labelled maintenance, a half-floor park and a smaller park that cannot hide stopped dealing. This is monitoring configuration only and uses the existing Deploy Monitoring provider; it requires no engine replacement or financial write.
