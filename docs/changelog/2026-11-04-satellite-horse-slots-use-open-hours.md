# Satellite horse slots respect admission hours

The satellite horse planner could draw an entire paid-fill opportunity inside the daily SNG entry closure. The observed 03:18–03:38 Chicago slot could never admit an entry and expired without a replacement.

The planner now excludes closed hours when creating a day and normalizes unclaimed, unexpired closed-hour slots through its existing union/day transaction. Partially eligible windows retain their eligible portion; wholly closed windows receive a random eligible time, preferably in their original day stratum. Claimed slots, expired opportunities, slot indices, selected boards, the 3–5 daily allocation, and funding remain unchanged. Daily allocation retains its Chicago calendar while admission closures use the configured policy zone, including adjacent dates and DST.

The function-only migration pins the installed planner preimage and verifies its owner, ACL and security configuration before and after replacement. It performs no table or trigger DDL and no installation-time data rewrite. Existing DDL break restrictions still apply; this correction requires no new engine contract.

Qualification: isolated PostgreSQL 17 reproduced the defect using the exact old planner and passed 15 focused groups after the exact migration, covering calendar boundaries, claims, expiry, partial windows, idempotence, ownership and live-proof checks. The existing required satellite CI step runs this qualification. Production installation and live verification remain pending.
