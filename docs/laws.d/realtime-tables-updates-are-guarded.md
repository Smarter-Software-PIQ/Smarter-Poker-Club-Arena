# tests/realtime-tables-updates-are-guarded.law.test.ts

Every `.from('tables').update(...)` call site in hot runtime paths (`server/src/engine/`, `server/src/tournament/`, `server/src/lightning/`, `server/src/services/supabase/tables.ts`, and `src/services/TableService.ts`) must guard against no-op `public.tables` updates that trigger `supabase_realtime` WAL fan-out by chaining a DB-side change filter (`.or(`, `.neq(`, or `.is(`), or be explicitly registered 1-to-1 in the audited finite allowlist with a documented one-off lifecycle, atomic state-transition, or in-memory diff-guard rationale.
