# tests/spin-and-sng-never-leak-start-clock.law.test.tsx

Spins and Sit & Go's (Heads-Up, 6-max, 9-max, and SNG satellites) always start when their seats fill and must display "When Full" / "Starts When Full" instead of a ticking "Starts In" countdown or formatted wall-clock timestamp across every Club Arena lobby, detail, blinds, card, search, and sign-up surface via the single authoritative `tournamentStartsWhenFull` helper, while scheduled MTTs keep their scheduled countdowns and open Spin cards keep their status bay invite-only even for `starting_soon`.
