# Tournament tab input normalization

Inherited object keys in tournament deep links could escape the tab normalizer and render no panel. The legacy alias lookup now accepts only its own declared properties; existing tabs, aliases and case/whitespace normalization are preserved.

Verification: five regressions failed before the fix, including two mounted TournamentDetails URL cases. All 75 focused assertions across three files and TypeScript compilation pass after the fix. Publication and live proof remain separate delivery gates.
