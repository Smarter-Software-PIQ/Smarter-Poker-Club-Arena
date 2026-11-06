# Customization certification enrolls independent browsers

The production realtime and commerce journeys created two empty browser contexts for one reserved account but did not complete the November 1 device pairing contract. The first browser enrolled; the second could authenticate but remained behind the same-device choice, so its next menu click consumed the entire journey deadline. Run 42246830038 timed out before the realtime sessions-ready marker; the commerce fixture had three auth sessions (API plus two UI sessions), one device and only one enrolled browser.

Both journeys now wait for normal first-browser enrollment and pair the second independent browser through Same As and Approve in the first owned browser. Identity, origin, distinct browser tokens and equal enrolled physical device are checked. No tokens or enrollment markers are copied or seeded. Account isolation, every cosmetic/SKU, concurrent purchase, realtime, reload, cleanup and existing time budgets remain unchanged.

Focused regression checks cover the actual enrollment consumer, pending/foreign identities, reserved hyphenated fixture names and wiring before profile/commerce interactions. Live production qualification remains required after protected merge.
