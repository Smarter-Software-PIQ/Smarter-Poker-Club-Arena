# Lobby sticky-filter tail proof

The remaining shared lobby journey clicked Cash Games closed and open, which natively scrolled the full selector deck into view. It then incorrectly required the compact rail to remain visible. The compact rail correctly stays hidden while the original controls are accessible.

The maintained journey now verifies the full deck and hidden rail after reopening, then scrolls the actual ALL cash catalogue away and requires the compact rail inside the viewport. On desktop it first verifies the full deck geometry, then scrolls the actual overflowing catalogue, requires positive inner scrollTop, and verifies the compact rail geometry and registration ink. Geometry checks explicitly distinguish the visible full deck from the collapsed desktop deck; neither state can pass with an empty control set. Phone and desktop screenshots remain attached.

The closed `verify-lobby-sticky-tail` request runs only this one remaining case with an empty payload, all 77 runtime pins, stable client/publisher identity, verified isolated-account cleanup, zero retries, and the existing case budget. The original nine-case catalogue and three-case remaining selection stay unchanged. This proof-only correction preserves the already passed filter, player-name and artwork checks and changes no product runtime source or assets.
