# Private atomic schema-restore lock capacity

Capture25 completed schema capture, then its single-transaction restore failed
with53200. The closed receipt does not identify its exact inner resource error.
An independent genuine PostgreSQL17.11 workload reproduced a concrete capacity
defect: the default64 lock setting failed in LockAcquireExtended after6,181 table
and2,205 function ownership operations. The same transaction at512 completed all
6,181 tables and5,453 functions. Both runs rolled back; the application role
remained a non-superuser and the temporary creator was absent.

Both disposable fixture entrypoints now use512 through their existing shared
startup arguments and assert the actual server setting before creating the
application role. Restore atomicity, role boundaries, memory/process limits,
timeouts and production configuration remain unchanged. Existing native CI
executes that readback; connected full-schema qualification must still pass
before attributing the observed capture failure or claiming product acceptance.
