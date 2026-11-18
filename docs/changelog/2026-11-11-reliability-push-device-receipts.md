# 2026-11-11: A reliability push is proven by the device, not by the provider

`reliability_notifications.push_state` stopped at `provider_accepted`: FCM or
Apple answered 2xx, which they also do for a phone that is asleep or gone.

Migration `20261111132958_reliability_push_device_receipts` adds a per-push,
per-device receipt:

- `smarter_private.push_device_receipts`: one row per push_outbox row and
  subscription, holding only the SHA-256 of a random token the World Hub
  dispatcher mints at send time (`public.fn_mint_push_receipt`). The token
  travels only inside that device's encrypted Web Push payload.
- `public.fn_record_push_receipt(outbox_id, token_sha256, stage)`: called by
  the World Hub route `POST /api/push/delivery-receipt` when the service worker
  acknowledges. `received` = the worker ran; `displayed` = the OS accepted the
  banner. Idempotent; a wrong token and an unknown id are the same `not_found`.
- `smarter_private.reliability_notification_device_receipts`: the view health
  and incident readers join. `delivery_state` is `displayed` or
  `device_received` once a device acknowledged, otherwise `push_state`.

`reliability_notifications` and its `push_state` CHECK are not altered: that
column is written by `reliability_refresh_push_states` inside the tick, and
`20261110144203`'s live proof requires a sent row to read exactly
`provider_accepted`. Only `reliability_*` events are minted. Both functions are
service_role only. No trigger on push_outbox, no foreign key on a hot table,
no timer.

Native proof: `scripts/ci/test-push-receipt.py`
(`.github/workflows/reliability-push-receipt.yml`).
