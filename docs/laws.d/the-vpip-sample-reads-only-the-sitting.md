# tests/the-vpip-sample-reads-only-the-sitting.law.test.ts

fn_nit_sample and fn_nit_hands_since are SQL functions with SET search_path, so
they are never inlined and run on a generic plan. Written as
`(p_since IS NULL OR f.played_at >= p_since)`, the sitting bound could not be an
index condition there, and every call walked the player's whole hand history
(horses hold 78k-178k rows). On 2026-11-11 both engine reads at the hand
boundary of a nit_game table hit the 8 s statement timeout, so hands started
about 16.9 s late and the Classic VPIP floor was neither read nor enforced on
those tables. The law pins that the newest definition of each function bounds
played_at with COALESCE(p_since, '-infinity'), which selects exactly the same
rows because played_at is NOT NULL, and never reintroduces the
`p_since IS NULL OR` form. The behavioural proof (plans before and after,
identical answers for every argument shape) runs against a real Postgres in
scripts/ci/test-vpip-sample-sargable.py.
