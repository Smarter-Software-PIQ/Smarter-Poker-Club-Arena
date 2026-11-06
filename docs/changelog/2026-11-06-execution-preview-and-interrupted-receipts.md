# Execution preview and interrupted local receipts

The existing push helper and immutable CI classifier now expose a shared execution preview before expensive gates. It names selected checks, components, check owners, scope expansion and unknown cost/access inputs. This initial shadow mode retains the current check admission; it does not certify reduced coverage or remove accounting tests.

The pre-push hook removes its previous receipt before starting and exits explicitly on HUP, INT and TERM, so interruption cannot reuse an old pass or record a successful current result.

The shared directly invoked module supplies input-closure fingerprints, explicit runtime/environment/schema invalidation, evidence validation, atomic operation owner/sequence transitions, unknown-outcome readback rules and measured metrics. The CLI exposes these operations for vendor adapters without creating a publisher, watcher or retry agent. GitHub evidence additionally needs authenticated provider provenance; local receipts never satisfy hosted protection.

Regression cases run in the existing required UI-selection Node gate and cover changed fixtures/configuration, unsafe paths, unsuccessful/untrusted evidence, owner conflicts, stale transitions, unknown-outcome retries and signal exit receipts. Existing routing and source-binding tests remain required. Current classifier pins are source identity updates only; historical financial qualifications are unchanged.

Broader dependency mapping, gate narrowing, cross-repository installation, artifact promotion and measured rollout remain separate acceptance items in this task's existing checkpoint. This foundation alone does not claim those items complete.
