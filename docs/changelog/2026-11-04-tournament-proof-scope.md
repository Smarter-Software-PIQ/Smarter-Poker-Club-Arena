# Tournament-only browser verification excludes the bounty journey

The existing closed tournament verification mode now skips the unrelated bounty guarantee journey. Its failure previously prevented the nine tournament cases from running under the normal success condition. Default publication verification still runs the bounty journey and retains its evidence on failure.

The existing bounty artifact condition already excludes skipped steps. Tournament authentication, staff access, the exact nine-case validator, release provenance, account cleanup and final certification remain required. A workflow-expression regression covers focused/default modes, unavailable production, failed authentication and evidence retention outcomes.
