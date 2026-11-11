# Bind census refunds to their own entry and read currency from receipts

Two defects remained in the frozen November 10 Horse census after refunds were
first netted.

The refund evidence was grouped by tournament and participant class. A file
whose rows were repeated was accepted and its refunds were subtracted twice,
limited only by the recorded cost. The census now requires row-level evidence:
one row per refund, bound through its own entitlement to the single funding
receipt it reverses. Ledger entry, registration, participant, tournament and
currency must all match, the credit must equal the refund, and each
registration's bound refunds must equal its unregistration receipt. A repeated
entitlement or registration, an unbound row, a refund above its receipt or a
grouped file refuses. Partial refunds and refunded rebuys and add-ons net
against their own receipts only.

The census also labelled every union event as a Diamond tournament. `is_xmtt`
marks a union event, not a currency, and the recorded funding receipts of those
events are in chips. Currency now comes from recorded funding receipts only. A
tournament without receipts is reported as unrecorded instead of assumed, mixed
currencies refuse, and recorded funding that is not gross entry, rebuy and
add-on charges refuses so a cost that is already net is never netted again.

Totals across currencies are unchanged; only the split between chips and
Diamonds moves. Offline reporting source: it reads no payment system, changes
no payment and certifies no wallet movement.
