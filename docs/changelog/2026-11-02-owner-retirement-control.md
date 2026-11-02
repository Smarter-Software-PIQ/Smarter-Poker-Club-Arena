# Owner retirement keeps its original stop operation

The November 2 retirement instruction superseded the previous equal-share and
whole-field refund plans. The existing operator workflow now accepts explicit
owner_request, owner_read and owner_ack actions for the immutable 140-event
manifest. They retain original operation IDs, reject the 73 excluded games,
verify original start time and current engine/lease identity, and drive only the
existing stop and boundary authorities. They have no financial settlement action.
Unknown acknowledgements are followed by one durable read and never retried.
Already committed dispositions are reported without another mutation. Public
artifacts retain only allowlisted identity and state plus receipt digests.

The original-refund SQL authority now also refuses these 140 identities before
any financial work, preserving prior receipts and unrelated events. The exact
captured production function and native regression demonstrate before/after
routing, outside-scope preservation and committed-receipt replay. This refusal
is not a transfer implementation or proof of physical retirement.

Validation: 95 operator transport tests passed, including existing controls,
all manifest identities/exclusions, stale runtime/lease/start evidence, lost ACK,
idempotent request readback and private-data exclusion. The isolated PostgreSQL 17 routing fixture passed against the exact captured
functions, including both prior-receipt paths and original-refund supersession.
Protected delivery is pending. Actual funded transfer and
terminal retirement remain unfinished; player-owned liabilities must be resolved.
