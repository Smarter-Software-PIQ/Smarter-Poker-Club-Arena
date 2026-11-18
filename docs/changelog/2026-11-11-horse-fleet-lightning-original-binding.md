# Bind Lightning originals in the Horse fleet report

The private fleet reducer could not read any Lightning capture. A Lightning
accepted terminal carries no accepted actor roster, so the reducer stopped on a
missing field; and Lightning accepts simultaneous fast-fold decisions made on
the same public state, so binding an executed action by its prior-action count
matched the wrong accepted action. Both were reproduced on two real Lightning
hands read through the deployed journal reader.

Lightning actor classes now come from the original decision-time player lists
of the same hand, labelled as such. Presence of an eligible human is claimed
only from a positive identification and absence only from a complete roster;
otherwise it stays unknown. A Lightning decision binds to the one accepted
action equal to its executed record, and an accepted action cannot bind twice
in any hand. An ordinary terminal without its accepted roster still refuses.
A capture with no journal records is reported as its own omission instead of
sharing the label of an incomplete review.

The retained historical captures reproduce the same 34 bound decisions, rows
and feature summaries. Offline reporting source; it activates nothing.
