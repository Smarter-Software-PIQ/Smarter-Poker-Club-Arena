# Waiting cash seats enter at their actual big blind

On the six-seat Madness PLO5 table, seats 1, 3 and 5 kept playing while funded seats 2, 4 and 6 waited. Twelve consecutive production hand records confirmed the alternating active roster. The BB predictor included every waiting seat when choosing the small blind, but the dealer excluded those seats. It could therefore predict a veteran BB forever, or release a newcomer who actually became the small blind.

The cash entry predictor now selects the first seat after the playing small blind and predicts the hand with only that entrant added. Other waiting seats remain held. The existing natural release, occupancy-bound persistence and actual blind posting stay authoritative. Tournament rotation, voluntary posting, and player identity treatment are unchanged.

Regression coverage exercises the incident with human and Horse identities, adjacent/wrapped waiting groups and heads-up expansion through the real dealer and HandController forced-bet events. It requires every entrant to post exactly one natural BB, never receive the button or an SB entry, and retain chip conservation. The original code fails five of six cases.

This is an engine change with no schema migration. Protected integration, exact Backup qualification, certified activation and live entry evidence are required before it is considered delivered.
