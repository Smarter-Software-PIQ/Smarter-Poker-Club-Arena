# Maintenance HTTP timeout preserves terminal settlement headroom

The maintenance Supabase client now validates its configured HTTP timeout. Invalid, non-finite, shorter-than-50-second and timer-overflow values fall back to the established 50-second default. Valid overrides up to the signed 32-bit timer maximum remain supported. This preserves the existing five-second headroom above terminal settlement's 45-second SQL ceiling without widening ordinary game-data requests.

The import-free resolver follows the ordinary client's invalid-configuration fallback. Boundary regressions cover missing, empty, malformed, zero, negative, non-finite, short and overflowing values, plus valid limits and fractional values. The terminal routing contract now checks the actual resolver and its default instead of extracting an unchecked literal.

Validation: 13 unsafe override cases failed against the previous conversion expression; all 83 focused timeout, cash-budget and terminal settlement tests passed after repair, and server TypeScript passed. Production configuration values were not inspected or changed. Merge, engine installation and live verification remain pending.

The shared transport deadline tests also verify an unsafe 100 ms maintenance override stays pending through 49,999 ms and expires at the 50-second floor, while ordinary and seeding clients retain their independent test budgets. All 47 focused resolver, routing and real-fetch/stream deadline tests pass.
