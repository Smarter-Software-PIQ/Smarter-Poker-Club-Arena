# tests/engine-lifecycle-logs-persist-without-ssh.law.test.ts

Incident 075013fd (Lane 1): engine boot, shutdown, leadership loss, deadline, and FATAL/crash events persist bounded, non-blocking rows to `public.engine_lifecycle_logs` (RLS enabled, explicit service_role-only grants, bounded payload/in-flight limits, unref'd flush timer) so any engine crash or failed boot can be read from the database without SSHing to the Hetzner host.
