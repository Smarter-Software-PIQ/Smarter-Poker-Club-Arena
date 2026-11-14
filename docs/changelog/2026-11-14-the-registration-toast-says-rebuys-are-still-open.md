# The registration toast says rebuys are still open (2026-11-14)

Owner law, Dan, 10:04 Chicago, November 14: no overlay chips go to a tournament until the registration, rebuy and add-on period has ended. When an event's rebuy levels run longer than its late-registration levels, registration closes at its own level, but the prize pool stays open through the rebuy levels.

This is the client half of #10837, published on its own because it needs nothing from the engine:

- When the `late_reg_closed` broadcast carries `rebuysOpen: true`, the tournament page toasts "Late Registration Closed. Rebuys Are Still Open".
- When it does not carry that field, which is every broadcast from the serving engine today, the page shows the same "Late registration closed" toast as before.

The engine half (the broadcast, and the short-guarantee alert at entry close) stays in #10837 and goes out with the next certified engine release.
