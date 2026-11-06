# Club Data Dates Survive Access Refresh

Post-publication browser verification reproduced custom dates resetting to today when access hydration unmounted Club Data. The reporting range now belongs to validated URL parameters, preserving custom dates and historical preset windows across remounts, reloads and browser navigation. The current-day preset still follows Chicago midnight. Existing authorization and private-data retirement remain unchanged.

The component regression failed on the published source and passes with the correction. Focused coverage also checks shifted historical windows, returning to today, invalid URL dates, custom-range shifts and Chicago day/DST rollover. No reporting SQL, financial writes, engine behavior or artwork changed.
