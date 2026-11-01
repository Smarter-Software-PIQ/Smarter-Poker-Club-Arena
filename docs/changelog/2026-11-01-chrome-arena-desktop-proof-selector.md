# Desktop Cash Proof Row Selection

The closed live Chrome Arena case now selects desktop cash rows by their actual table row, kind and persistent identifier. The compact-only test identifier previously prevented the desktop text-fit assertions from running. All geometry, font, provenance, persistence, cleanup and time limits remain unchanged.

Required CI also exposed an intermittent stale-membership fixture failure. Its two isolated cases and the prior published build pass unchanged; the intermittent cause is not established. The fixture now starts exactly one captured deferred read before confirmation and verifies it remains the original read before release. Both final state assertions, product guards and deadlines remain intact.
