# Tournament Favorite Priority

A starred tournament now moves directly below the host's current pinned events, ahead of the normal schedule, including when a player selects a column or filter-sheet sort. The existing chosen order and seat availability order remain stable inside each tier. Cash-game stars retain their existing ordering behavior.

The ALL lobby ranks current pins and favorites before its existing ten-event MTT cap, so a lower-priced favorite cannot disappear before the table receives it. Pin eligibility still comes from the shared calendar-day policy. Favorite ownership, persistence and star handlers are unchanged.

Mounted regressions cover starring and unstarring in both layouts, chosen sorts, Spins, Sit N Go's and Satellites, changed favorite-owner input and cash ordering. A cap fixture and the existing ALL source contract cover selection before the cap.

The existing isolated lobby proof now accepts one additional closed empty request, `verify-tournament-favorites`, for exactly the real Chromium phone star, sort, reload/readback and unstar journey. It retains the existing account cleanup and protected-source/two-endpoint publisher provenance requirements, with no skipped or retried case accepted. The browser executor is explicitly Ubuntu 24.04, supported by the locked Playwright version; the other closed modes and all checks remain intact.
