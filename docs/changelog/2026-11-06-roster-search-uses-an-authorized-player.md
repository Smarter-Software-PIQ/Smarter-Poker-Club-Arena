# Roster search proof uses an authorized player

The production roster relevance check previously assumed a player named Mikey existed and inherited the saved roster filter. It now explicitly selects All Players, clears a saved search, and chooses a searchable identity from the authorized initial roster response. The searched response must belong to the same club, use All Players, have no cursor, and match that exact search.

The independent exact/prefix/substring/context ranking assertions, nonempty results, rendered first alias, disabled relevance sort and restoration of manual oldest ordering remain. No product code or production member data changes.

The existing source-contract suite reproduces the obsolete fixture before the correction (1 failed, 29 passed) and passes afterward (30 passed). The observed production failure reported zero rows; current read-only name checks found no Mikey identity, but the historical request/filter payload was unavailable. This correction does not claim a replay of that historical request. Hosted production verification remains required.
