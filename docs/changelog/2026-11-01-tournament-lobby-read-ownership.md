# Tournament lobby reads belong to the current club and player

The global tournament lobby kept the previous player's registration batch after an account change, retained union membership after moving to a standalone club, and could paint a former club's rows when the new request failed. Initial list errors appeared as Nothing Scheduled; unresolved transports could leave loading indefinitely.

The board is now keyed by club and viewer. Each existing read has the maintained twelve-second deadline and aborts when its owner retires. Request generations still reject stale results. Membership includes both true and false outcomes. A failed list has an explicit unavailable state and Retry; confirmed empty lists retain their existing empty state. Optional Diamond Spin enrichment keeps its own existing unknown fallback. No polling, payment, engine, artwork or business-filter behavior was added.

Seven mounted regressions failed before the repair; the confirmed-empty control passed. All eight pass afterward. Connected lobby checks total129 passing assertions after retaining the existing generation-guard source contract. Independent parent source review found no actionable issue. Protected merge, publication and affected served behavior remain pending; these local results do not certify a production tournament completion.
