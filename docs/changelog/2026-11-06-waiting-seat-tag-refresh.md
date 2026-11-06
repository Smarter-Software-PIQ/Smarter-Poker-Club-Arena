# Waiting seat tags survive database refreshes

Live verification of the occupied-seat engine fix found that the existing ten-second database refresh changed waiting entrants from sitting out to active. Their avatars remained seated, but their Waiting For BB tags disappeared until the next engine event because the database voluntary sit-out flag does not encode the engine's entry hold.

The refresh now preserves the engine's waiting list, and the seat badge independently follows the authoritative entry reason. Admission clears the waiting list normally; actual departures and replacement occupants retain their existing behavior. This is a client-only correction using the deployed engine contract.

The regression executes the actual refresh callback between rendered seat updates and covers repeated refreshes, admission, sit-out, departure, replacement, folded/all-in precedence, and posting suppression. Two cases failed before the correction; all 55 focused tests passed afterward, as did TypeScript.
