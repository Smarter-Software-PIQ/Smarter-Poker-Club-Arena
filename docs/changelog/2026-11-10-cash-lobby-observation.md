# Cash lobby observation

View Game now counts actual game tabs against the four-game limit, preserving Lobby and Hub pages without letting those pages block a fourth game. Existing games remain mounted and a fifth game still reports the limit.

A confirmed ordinary-table waiting-list join opens the same prepared spectator route as View Game. A refused join or leaving the queue does not navigate. Failure to prepare observation leaves the confirmed queue place intact. Must-Move game admission continues through its existing game-level door.

Regression coverage reproduces the former fourth-game refusal and the two waiting-list successes that stayed in their routed/embedded lobby. Mounted tests cover successful observation, rejected joins, preparation failure, leaving, and the real four-game limit. The existing production lobby suite also exercises four spectator games plus a retained lobby with participation requests refused.
