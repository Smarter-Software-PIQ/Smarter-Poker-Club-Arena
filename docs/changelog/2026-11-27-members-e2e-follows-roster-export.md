# The production Players spec checks the new Roster Export buttons

PR #12235 moved Select Loaded and Export CSV into the Roster Export case
(`.roster-records__actions`) and dropped the old `.members-select-loaded` and
`.members-export` classes from the roster footer. `tests/e2e/production-club-members.spec.ts`
still looked for those classes, so "keeps roster surfaces and controls inside the actual
page" found zero controls and failed the post-deploy Client browser verification
(run 46063424139). The spec now checks `.members-roster-footer .roster-records__actions button`,
so the containment check runs against the real buttons again.

The second failure in that run, a `[MemberAssignAgent.load] TypeError: Failed to fetch`
console error on the Player Record page, is a network fetch failure in code #12235 did
not touch; it is not changed here.
