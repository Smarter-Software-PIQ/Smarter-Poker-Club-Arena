# Private replay failure boundaries

The finite V56 private replay command previously emitted the same unavailable summary for every failed boundary. It now adds a closed `failureStage` enum to unavailable stdout and its private refusal receipt. The label identifies the failing operation, not an inferred underlying cause. Error messages, paths, actor identities, cards and replay inputs remain excluded; qualification and activation remain false.

Existing source/runtime pins, protected control, accepted-case joins, private cleanup and workflow transport are unchanged. The workflow checks out the exact serving revision: these diagnostics become available only when that revision includes this change. They cannot diagnose an old run retroactively or authorize replay against a different source. Existing-output protection still refuses replacement.

Focused regressions distinguish argument, input-read and request-validation failures while asserting exact sanitized fields and absence of private markers, file paths and raw parser errors.
