# Card Artwork Is Decoded Before Table Reveal

Hole and board cards could show the small emergency rank/suit face, then replace it with full artwork during the deal. The idle-only warmer began several seconds after navigation, treated a request as success, discarded the image handles and warmed only the initial preference. Per-reveal preload was too late for cold images or a changed deck.

Table entry now prepares all 52 selected faces through a shared six-request load and waits for successful decoding in the existing table-art cover. Decoded image bytes and their local object URLs remain retained for both supported decks; a successful PNG fallback becomes the renderer's actual URL rather than repeating the missing WebP. Reveals therefore perform no new network or service-worker request, including after HTTP cache eviction. Deck preference changes prepare the correct deck independently. Each request has a bounded deadline; failures never mark the deck ready. The existing 12-second cover limit and accurate unreadable/error faces preserve access to a live turn during asset failure. Dealing and squeeze animations remain unchanged.

Regression coverage checks decode completion, concurrent callers, warm remounts, both decks, Data Saver, WebP/PNG failure and recovery, and the existing cover deadline. This is a client-only change using existing engine APIs.
