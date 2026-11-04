#!/bin/zsh
# Runs psql against PokerIQ-Production through the existing helper. The password
# comes from the user's zsh environment (~/.zshenv), never from this folder.
cd ~/.smarter-poker/ops || exit 2
exec python3 -B work/direct-db.py -X -At "$@"
