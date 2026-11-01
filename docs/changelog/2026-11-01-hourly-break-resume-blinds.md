# Hourly break resume display

The tournament Blinds tab advertised the following level during hourly breaks even though the engine retains its current level and remaining clock. Hourly row and broadcast breaks now show the current level and its exact committed amounts. Legacy structure breaks retain next-row resume behavior; mismatched blind receipts do not invent amounts.

Verification: three mounted cases failed before the fix; all 72 focused assertions across three files and TypeScript pass afterward. Engine timing and artwork are unchanged. Protected publication and live verification remain separate.
