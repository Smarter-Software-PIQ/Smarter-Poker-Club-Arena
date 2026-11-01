// Isolated container PID1. The trigger is a private fixture file, not an engine API.
const fs = require('node:fs');
const addon = require('/fixture/fault.node');
if (process.argv[2] === 'foreign') addon.fault();
else {
  fs.writeFileSync('/fixture/ready', JSON.stringify({pid:process.pid,version:process.version}));
  const poll = setInterval(() => {
    if (!fs.existsSync('/fixture/fire')) return;
    clearInterval(poll);
    if (process.argv[2] === 'storm') addon.storm(); else addon.fault();
  }, 10);
}
