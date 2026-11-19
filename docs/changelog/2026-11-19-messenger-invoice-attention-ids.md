# 2026-11-19: one read answers which invoices still need action

The Messenger main inbox (World Hub, PR #2891) now reads a window of each inbox
instead of every thread a person has ever had. An invoice that still requires
action must never fall outside that window.

The installed reader, `fn_messenger_private_invoice_attention(p_user_id,
p_conversation_ids)`, answers for at most 100 named threads, so finding every
action-required invoice with it means asking about every invoice thread, which
is the unbounded load being removed (the owner account holds 4,585 accounting
threads).

`fn_messenger_private_invoice_attention_ids(p_user_id)` returns only the ids of
the caller's invoice threads that require action: the same joins, the same
active-membership check and the same `requires_action` expression as the
installed reader. It is read-only, SECURITY DEFINER with a pinned
`search_path`, and executable by `service_role` only, exactly like the reader
it is derived from. Nothing existing is replaced. The migration's postflight
checks the grants and compares its answer with the installed reader on a
sample.

Checked read-only against production before delivery: over the 25 accounts with
the most invoice threads (3,252 threads) the new query and the installed
reader agreed on every thread.

The World Hub code falls back to the previous exact behaviour while the
function is absent, so the order of the two deliveries cannot break the inbox.

`tests/unit/messengerInvoiceAttentionIds.test.ts` pins the function's
signature, grants and rule.
