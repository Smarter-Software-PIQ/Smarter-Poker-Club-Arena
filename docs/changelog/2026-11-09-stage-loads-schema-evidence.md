# Load Backup schema evidence during daily selection

Daily Stage run 42562159686 reached selection, then stopped when the installed-migration reader tried to import the schema evidence module outside its sparse checkout. The selection job now checks out `server/standby` alongside its existing scripts. A regression uses the workflow's checkout paths in a real sparse Git tree and loads the schema evidence through the selector.
