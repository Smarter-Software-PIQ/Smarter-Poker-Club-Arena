# Table Chat History Preserves Intervening Messages

Delayed initial chat history replaced the current message list, erasing a source-table seat-move announcement or realtime chat row that arrived while the read was pending. Hydration now merges by message ID, retains the current version of an existing line, and orders the bounded 50-line history by timestamp. An actual table identity change clears the previous room; replaying the same room's effect preserves its lines. The existing late-response fence remains.

The isolated regression uses the real seat announcement and chat hooks: the old source loses the announcement when deferred history resolves. The repaired source preserves the notice and saved row exactly once, including a later duplicate delivery. A separate table-switch case refuses the old room's late history and local lines. Initial seat-event preservation under StrictMode is additional boundary coverage, not a separately reproduced defect.

This reproduces a generic source race. The retained production seat-notice failure did not capture event/history ordering, so this is not proof of that failure's cause. No production probe, timeout, assertion, artwork, or animation changes.
