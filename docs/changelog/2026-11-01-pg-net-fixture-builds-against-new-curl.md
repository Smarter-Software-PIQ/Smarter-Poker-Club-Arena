# 2026-11-01: the pg_net removal fixture builds against the newer libcurl

Since about 00:45 UTC on 2026-11-01, `Accounting transactions (PostgreSQL 17)
shard 2/7` failed on runners with image `ubuntu-26.04` 20261025.179.1 while it
passed on 20261025.353.1. `scripts/ci/test-unused-pg-net-removal.py` builds
pinned pg_net from source against the runner's libcurl headers, and on the
failing image `curl/multi.h:429` no longer compiles:
`expected identifier or '(' before '__extension__'` at the
`curl_multi_setopt` declaration. The libcurl `typecheck-gcc.h` wrapper macro is
already defined when `multi.h` declares the function.

Fix: the pg_net build passes `COPT=-DCURL_DISABLE_TYPECHECK`. The typecheck
macros are compile-time diagnostics only and do not change the built
extension. `COPT` is appended to the PGXS CFLAGS, so pg_net's own flags are
untouched. Pinned sources, digests and every assertion are unchanged.
