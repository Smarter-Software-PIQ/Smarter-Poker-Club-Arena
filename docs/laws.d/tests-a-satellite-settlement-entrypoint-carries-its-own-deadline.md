# tests/a-satellite-settlement-entrypoint-carries-its-own-deadline.law.test.ts

The capped satellite qualifier executor the engine calls through PostgREST declares the same 45s statement_timeout as the terminal request it runs, so settlement never runs under service_role 8s.
