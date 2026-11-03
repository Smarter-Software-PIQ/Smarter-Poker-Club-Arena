#!/bin/zsh
# Installs (or refreshes) the operations services on this Mac from this
# checkout: copies the scripts to ~/.smarter-poker/ops, links the database
# connection metadata and CA certificate from the repository checkout you name,
# renders the launchd services and (re)loads them.
#   usage: operations/ops-mac/setup.sh /path/to/club-arena-checkout
# No credential is copied: db.sh reads SUPABASE_DB_PASSWORD from ~/.zshenv.
set -e
SRC=${0:A:h}; CHECKOUT=${1:?checkout path required}
O=~/.smarter-poker/ops; LA=~/Library/LaunchAgents
mkdir -p $O/work $O/supabase/.temp $O/scripts/ci/certificates ~/.smarter-poker/install-queue/{pending,running,done,failed} ~/.smarter-poker/logs
cp $SRC/{db.sh,install-queue.sh,install-driver.sh,submit-install.sh,heartbeat.sh,readback.py,README.md} $O/
cp $SRC/direct-db.py $O/work/direct-db.py
cp $CHECKOUT/supabase/.temp/pooler-url $O/supabase/.temp/pooler-url && chmod 600 $O/supabase/.temp/pooler-url
cp $CHECKOUT/scripts/ci/certificates/supabase-prod-ca-2021.crt $O/scripts/ci/certificates/
chmod +x $O/*.sh $O/readback.py
for L in com.smarter-poker.install-queue com.smarter-poker.ops-heartbeat; do
  sed "s#__HOME__#$HOME#g" $SRC/launchd/$L.plist.template > $LA/$L.plist
  plutil -lint $LA/$L.plist
  launchctl bootout gui/$(id -u)/$L 2>/dev/null || true
  launchctl bootstrap gui/$(id -u) $LA/$L.plist
done
echo "installed; check: launchctl print gui/$(id -u)/com.smarter-poker.install-queue"
