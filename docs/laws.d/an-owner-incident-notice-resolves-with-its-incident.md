# tests/an-owner-incident-notice-resolves-with-its-incident.law.test.ts

When a drift incident resolves, fn_ca_incident_resolution_reaches_the_alerts resolves, in the same transaction, every firing owner-operational-notifications copy that names it, so its Reliability Controller incident closes through the normal resolved path; an aged-out incident still resolves nothing.
