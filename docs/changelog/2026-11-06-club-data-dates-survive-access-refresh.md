# Club Data Dates Survive Access Refresh

Post-publication browser verification reproduced custom dates resetting to today when access hydration unmounted Club Data. The reporting range now belongs to validated URL parameters, preserving custom dates and historical preset windows across remounts, reloads and browser navigation. The current-day preset still follows Chicago midnight. Existing authorization and private-data retirement remain unchanged.

The component regression failed on the published source and passes with the correction. Focused coverage also checks shifted historical windows, returning to today, invalid URL dates, custom-range shifts and Chicago day/DST rollover. No reporting SQL, financial writes, engine behavior or artwork changed.

The same post-deployment run exposed an ordering defect in its existing browser workflow: bounty verification's shared browser setup joined the reserved account as a player before staff preparation. The preparation helper correctly refused the existing membership, preventing private-template setup and cascading into later checks. Bounty verification now follows staff and template preparation. The existing membership refusal, zero-balance checks, cleanup and all browser assertions are unchanged; a workflow-order regression pins preparation before the first browser invocation.

The required workflow precheck also exposed a sandbox-only timing mismatch: the degraded-engine transaction took 25.8 seconds alone on external-SSD macOS and was killed by its 30-second child timeout under parallel load, despite the enclosing test already allowing 90 seconds. Its child ceiling is now 75 seconds within that existing test budget. Production deadlines and every transaction assertion remain unchanged.
