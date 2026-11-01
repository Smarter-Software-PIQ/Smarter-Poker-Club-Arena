# Spectators see matching avatar artwork

Spectating a full table previously skipped opponent normalization because there was no seated Hero. The bottom chair still used its full-size wrapper while the remaining chairs used smaller portrait slots.

The occupied bottom chair now supplies the display reference without changing any player's Hero flag, seat rotation, identity, cards or permissions. Its artwork stays unchanged; the other avatars match its decoded painted height. If that chair is empty, the largest native decoded subject supplies the height only, and no side chair becomes a protected Hero. The reference chair's existing artwork, captions and cards remain fixed obstacles for the same bounded placement transaction and the existing position lock.

Normalization now uses computed pixel dimensions for proportional image slots. Integer `offsetHeight` rounded a real 73.78125px observer reference to 74px and produced a measurable mismatch. No table, card, panel or control dimensions changed.

Regression coverage includes mixed decoded artwork, occupied and empty bottom chairs, fractional dimensions, repeated preparation, reference protection, phone/reference-phone/iPad rendering, and fixed artwork through focus, actions and new hands. Spectator checks require zero Hero seats, the existing Spectating footer and no player action controls. Existing occupied-player layout checks remain in the same browser gate.
