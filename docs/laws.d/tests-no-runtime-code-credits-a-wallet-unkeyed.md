# tests/no-runtime-code-credits-a-wallet-unkeyed.law.test.ts

`atomic_credit_wallet_and_log` credits a player's wallet and accepts a null
idempotency key, so a retried call from application code can pay the same
chips twice. Every engine refund and cashout already runs inside a keyed SQL
function; `resolve_pending_addon` keys its add-on refund `addon_refund:<row
id>`. The last runtime caller, the engine's `_refundAddOnToWallet` helper in
`ServerTableEngineSeating.ts`, had no callers and took its key as optional. It
was removed on 2026-11-26. The law pins that no file under `src`,
`server/src` or `supabase/functions` (tests excluded) calls the raw credit RPC,
and that the helper does not come back.
