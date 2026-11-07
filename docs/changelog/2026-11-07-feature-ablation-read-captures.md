# Preserve offline Horse decision read captures

The feature-ablation worker's telemetry wrapper dropped the chooser's range and plan read capture arguments. Forward both original capture objects unchanged so offline receipts describe the actual chooser reads instead of falsely reporting that they were not reached. Strategy, accepted actions and accounting are unchanged.

The focused worker regression requires both captures at the chooser, a bound observed plan read, and the existing controller-accepted effect acknowledgements. The missing-capture regression fails before correction. Rerun the retained exact development pair separately to establish its newly observed read status; old accepted-action and accounting evidence remains separate from the defective diagnostic.
