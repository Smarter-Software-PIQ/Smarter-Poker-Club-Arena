# tests/accounting-shard-prerequisites.law.test.ts

An accounting CI suite relies only on its own shard's setup: root dependencies are common setup before any suite, and every suite that compiles against the PostgreSQL server headers runs on a shard whose installer arm installs them.
