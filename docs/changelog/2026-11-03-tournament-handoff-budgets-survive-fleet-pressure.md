# Tournament handoff budgets survive fleet pressure

The stuck-table escalation owner cleared every per-table handoff count once its
map exceeded 500 entries. A fleet with 501 exhausted tables therefore received
501 additional successor requests on the next discovery pass, defeating the
three-handoff limit and restarting recovery churn without any new evidence.

Keep each unresolved table's allowance across fleet growth and manager gaps.
Existing healthy progress still releases its entry. The existing terminal-table
stop path now releases entries after its fresh database closure proof and
successful exact-instance retirement, including an already-absent engine.
Unknown closure, stopped-engine cleanup refusal and a successor winning the
registry slot retain the allowance. No new polling or release mechanism is added.

Regression: the actual GameServer methods fail three new cases before this
change and pass all 16 cases afterward. The focused suite plus registry and
weekly-payout custody suites pass 24 tests. Production delivery and live behavior
verification are separate requirements owned by the parent recovery task.
