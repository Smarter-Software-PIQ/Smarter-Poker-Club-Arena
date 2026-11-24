# tests/every-alert-producer-declares-its-resolve-path.law.test.ts

Every source recorded in operational_alert_events declares how its firing rows resolve in docs/reliability-controller/alert-producer-resolution.json (in-function, twin-event, mirror, informational, or pending with an owner and a hard date); an in-function resolver must be proved in the migrations.
