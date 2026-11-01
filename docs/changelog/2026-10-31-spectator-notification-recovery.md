# Spectator And Notification Recovery

Notification filter choices now remain pending while offline and resume their original owned save on reconnect, without requiring a reload or creating another intent. Account changes, newer choices and already-confirmed writes cannot replay an old save. Focused regressions cover offline choices, remount/account isolation and a failed transport followed by reconnect.

The original WebKit production case now verifies the durable offline choice, its actual successful save after reconnect, journal retirement and persisted server readback. It no longer assumes that an offline browser must emit a failed network request; its timeout and persistence requirements are unchanged.

The historical spectator navigation failure predates the existing protected preparation-contract repair in #8982. Its mounted caller regression passes: navigation waits for successful preparation and stays in the lobby on refusal. No additional spectator source change or timeout increase was made here.

The maintained isolated lobby proof gains one closed request for exactly the original Chromium spectator case and WebKit notification reconnect case. It retains protected source and two-endpoint publication checks, exact per-case browser identity, no skips or retries, and verified cleanup of its isolated account. The original lobby proof remains available unchanged.
