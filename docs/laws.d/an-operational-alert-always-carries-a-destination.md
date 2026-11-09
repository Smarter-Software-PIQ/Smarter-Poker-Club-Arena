# tests/an-operational-alert-always-carries-a-destination.law.test.ts

Every row inserted into operational_alert_events carries payload.target_task_id: the owning table stamps the fleet destination when a sender omits it (ca-stall-watch omitted it for 601 rows in 7 days) and never overwrites one a sender set.
