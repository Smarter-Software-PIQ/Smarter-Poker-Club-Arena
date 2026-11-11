# Add-On Bank-To-Crown Flight

The add-on notice now prints `+29 Added On` as small green text, traveling from the player's chip balance to just above the visible avatar crown and fading immediately there. The normal-speed flight lasts 800ms and respects the existing animation-speed preference. Reduced motion keeps a readable stationary fade.

The engine's applied amount, per-player seat ownership and reconnect receipt deduplication remain authoritative. A new receipt remounts its animation. The yellow speech panel, repeated player name and tail are removed from add-ons; ordinary chat and voice bubbles retain their existing presentation.

Validation: applied-event/expiry/ownership/reconnect/slow-speed unit coverage, real browser start/crown/fade geometry at 375px, 393px and 1000px including scaled seats, narrow offset panes, top-arc seats and reduced motion; client compiler and applicable copy/style gates.
