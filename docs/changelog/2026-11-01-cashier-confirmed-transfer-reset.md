# Confirmed Cashier Transfers Return To The Start

A fully confirmed Send Out or Send Ticket now closes the amount dialog, clears the player search and selection, retires transaction inputs and in-memory retry keys, and removes the batch recovery receipt. A confirmed Club Bank self-send uses the same reset. The success notification and authoritative transaction history remain available. Partial, refused and uncertain batches retain their receipt, inputs and recovery handling; unrelated unresolved journals are preserved.

The previous success path cleared only the amount dialog and amounts, while always setting a batch receipt. This left a completed transfer looking active and displayed an unconfirmed-outcome warning for confirmed sends.

Validation: rendered cashier regression cases fail before the repair because the completed search remains. The affected 91-case suite passes after the repair, including chunked batches, individual amounts, retry identity, partial acknowledgements and unrelated recovery journals. No financial RPC or engine contract changed.
