# Observe wallet readers immediately before sending

The ordinary wallet cutover now completes its existing PostgreSQL transaction-budget setup before observing relation holders. The observer and current DDL-window check run immediately before the original single transaction, removing two database round trips during which a recurring reader could re-enter.

The existing sixty-second read-only observation bound, single NOWAIT acquisition, one-second lock limit, five-second statements, eight-second transaction guard, issuer identity and exact source history remain unchanged. No reader is terminated and no SQL is retried. This reduces the demonstrated gap; it does not guarantee a lock against every concurrent arrival.

The maintained native TLS PostgreSQL fixture reproduces the old order with a real reader entering during budget setup, then proves the new order waits for that reader to finish naturally before the same transaction succeeds. Other financial qualification inputs and evidence are unchanged.
