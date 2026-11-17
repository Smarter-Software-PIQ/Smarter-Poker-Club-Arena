# Pacific Data Recognises Linked Spin Fee Refunds

The November 3 legacy Pacific load refused 64 cancelled Spin fee records totaling
366.72. Each negative record points to an original positive fee recognition, but
the history reader searched for player fee receipts on the negative record only.
All 192 original player and club fee shares independently match their existing
negative UTC control rows exactly.

The report reader now follows that explicit original link for a full Spin fee
refund. It requires the same tournament and original club, the exact opposite
amount, an approved original and reversal source, one reversal link, and complete
unique original player fee receipts conserving the amount. Invalid or ambiguous
evidence stays unqualified. Recognition uses the refund timestamp. Existing
financial records, cancellation writers and UTC controls are unchanged.

The maintained native PostgreSQL route reproduces the former refusal, qualifies
64 linked refunds after installation and checks malformed links, mismatched
tournaments, partial refunds, duplicate reversals, incomplete fee shares,
private permissions and idempotent history admission. Production completion
requires protected migration installation followed by one qualified November 3
read-model rebuild and live readback; local qualification alone is not delivery.
