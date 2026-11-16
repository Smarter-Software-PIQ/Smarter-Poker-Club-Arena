# A Failed Worker Keeps Its Safe Check

Promo signup qualification exposed an existing random-deal failure in the
fixed-limit fallback law: a no-limit free check became a bet. The worker had
failed correctly, but the commit-time premium-hand rule could turn its
unpriced liveness check into a value bet. AA on a 2-7-9 flop reproduces the
failure deterministically before the correction.

Commit-time aggressive wager rules now preserve worker and brain-exception
liveness actions. The existing short-all-in call floor still runs afterward.
The original law includes the deterministic premium-hand case, and its
short-all-in source contract follows the same final-rule boundary.

Focused fallback, telemetry and premium-hand checks pass; server compilation
passes. Full qualification and protected delivery remain required. This is
an engine runtime correction: certify on Backup and activate only through
the next qualified 04:00 Chicago release. The signup database installation
retains its own declared daily-maintenance route.

Promo principal qualification also reproduced a late top-up entering the
finished hand after HAND_COMPLETE cleared its controller. The original add-on
owner now queues while settlement remains in flight, matching the Diamond
owner. Two regressions exercise the actual settlement collection, including
settlement beginning while the add-on waits for its seat boundary. This fix
must be serving before promo enforcement is activated.
