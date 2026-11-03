# Tournament hold reader permission contract

The installed notice reader permits authenticated and service callers, while the existing privileged-function lock denies anonymous execution. Its prior migration declared three-role availability, which was not true after the enabled grant guard ran. All current Club Home, Tournament Details and Tournament Lobby consumers are behind AuthGuard.

A forward migration aligns the function's accepted roles and grants with those consumers. It preserves the exact notice, hold row, schedules and registration behavior. It neither removes the existing lock nor alters or bypasses the security scanner. Previously installed migration bytes and their historical proof remain unchanged.

The maintained qualification captures the actual reader, scanner and existing lock metadata through read-only catalog queries. In an isolated PostgreSQL17 cluster it reproduces the old three-role proof failure with the event trigger enabled, applies the exact candidate, proves unchanged hold/lock/scanner state, and executes the reader under actual authenticated and service roles. Anonymous access remains denied even when its JWT role string is spoofed. Released and absent hold behavior remain covered. The required cancellation shard invokes these nine cases; no production operation is performed by the fixture.

The older local scratch harness changed only the JWT role string while remaining the database superuser; that was not evidence of anonymous execution permission. Source qualification and protected installation/live readback remain separate.
