# tests/a-silent-host-is-noticed-within-minutes.law.test.ts

Operations hosts report a heartbeat every 5 minutes; a host silent past its allowed silence raises one critical Production Alert per outage, recovery is recorded as an informational event keyed to that outage, a volume under 5% free warns once per day, and the check moves nothing.
