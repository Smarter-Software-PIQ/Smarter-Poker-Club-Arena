# Tournament Details registration and add-on terms

Details now states the late-registration closing rule, with a local-time estimate when the running level clock is readable, and explicitly shows Add-On Yes or No. Enabled add-ons include their purchase price in the event's currency, tournament chip stack, and actual persisted offer window or the configured break timing before that window opens.

The previous add-on value omitted price and inferred a level range from rebuy/addon levels even though purchases use a durable timed window. The display now follows that window, including Free Buy seating availability, and changes to Ended at its deadline. Registration uses the existing earlier-of-level-and-minutes projection. Rules, prices, transactions and the engine are unchanged.

Regression coverage exercises the real Details rows, enabled/disabled refresh, level/minute closure, paused or missing clocks, persisted add-on boundaries, Free Buy timing and Diamond pricing. This is an independent client publication with no new engine contract.
