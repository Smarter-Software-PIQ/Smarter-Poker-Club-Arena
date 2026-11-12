# Tournament arrival status

Tournament arrivals held for the button show “Sitting Out” on the seat and hero footer. The engine’s admission flag still clears the hold and reveals the dealt hand; no return action or cash blind-post prompt is added. Cash BB entry labels and posting behavior remain unchanged.

The existing seat rendering tests cover the tournament label and cash states. The maintained production seat-move browser proof checks the label and subsequent dealt cards without moving a real player. The previously merged tournament admission correction and cash restoration still require engine activation and natural-arrival acceptance.
