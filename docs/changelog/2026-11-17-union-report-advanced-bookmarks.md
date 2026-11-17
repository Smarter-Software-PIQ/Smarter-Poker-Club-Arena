# Union Report opens Advanced and restores old bookmarks

Report on the everyday Data page now explicitly selects Advanced while keeping
its inclusive first and last dates. This navigation takes precedence over a
saved Simple preference; both mode buttons remain usable and preserve the range.

Old `/unions/:unionId/data/advanced` bookmarks resolve the union slug or UUID and
its actual house club, then replace the URL with the existing club report route.
The redirect preserves date parameters (including legacy `dataUntil`) and the
fragment. A missing/refused lookup stays on an explicit error; no member club is
guessed. Existing destination membership and whole-club report guards still apply.

Three deterministic Chromium cases mount the real Data pages, URL canonicalizer,
redirect and reconciliation UI with local account/server I/O. They cover Report
with saved Simple, old slug and UUID bookmarks, inclusive date/query preservation,
BBJ visibility, and mode toggling. They run in the existing required browser job.
