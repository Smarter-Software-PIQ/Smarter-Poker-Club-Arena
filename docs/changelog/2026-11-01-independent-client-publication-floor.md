# Independent client publication validates source without an engine time hold

The static publisher's existing activation-floor CLI validated immutable protected source and then refused clients before an unrelated engine activation timestamp. Static publication now retains the exact-source, schema, control, owner-window witness and clock validation while leaving engine timing to engine modes. Clients using existing engine APIs can publish through the existing provider immediately. Explicit dependencies on new engine APIs still require compatibility proof under PUBLISHING.md.

Engine manifests, owner windows, history, witnesses, admission timing, lead times, cutover budgets, runtime entry and recovery remain unchanged. No alternate publisher or bypass was added. The workflow job and its required success dependency remain; display names now describe source validation.

Regression protection drives the actual publication CLI over real immutable Git fixtures before daily and owner boundaries, at activation and after expiry. Invalid source, schema and control remain refused; engine early/expired refusals and clock checks remain pinned. The existing 23-test operational suite stays enforced by its existing law test.
