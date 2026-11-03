# Lightning Leave Intent

Stand Up & Leave now reports the player's leave intent before awaiting the durable matchmaking stop. TablePage immediately suppresses turn attention and supersedes pending pre-action retries. A refused or thrown stop restores attention; successful stop still precedes the existing exact-hand fold and anchor cash-out.

Focused control tests verify intent-before-stop ordering, duplicate-click collapse, stop refusal recovery, and preserved leave behavior. This client change uses existing engine APIs.
