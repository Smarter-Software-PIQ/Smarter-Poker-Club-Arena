# tests/cash-view-game-never-joins.law.test.tsx

View Game, View Table and Watch are spectator actions across cash variants,
card presentations, game modes and admission states. They must invoke the
public-table viewer without joining or changing a waitlist. A missing viewer
or an in-flight cash action disables the control. The mounted ClubHome recovery
suite guards preparation, errors and embedded popup dismissal; the mounted
MultiTable suite guards same-URL selection and reuse at the four-game cap.
These tests execute in the existing required client unit-test workflow.
