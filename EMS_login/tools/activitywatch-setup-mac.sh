#!/bin/bash
# GrowthApex EMS - connect ActivityWatch to the EMS dashboard on a Mac (run once, after installing ActivityWatch).
# Lets https://growthapex.in read the app/website usage summary from ActivityWatch on this Mac.
#   curl -fsSL https://growthapex.in/EMS_login/tools/activitywatch-setup-mac.sh | bash
set -e

CFG="$HOME/Library/Application Support/activitywatch"
mkdir -p "$CFG/aw-server" "$CFG/aw-server-rust"

cat > "$CFG/aw-server/aw-server.toml" <<'EOF'
[server]
host = "localhost"
port = "5600"
storage = "peewee"
cors_origins = "https://growthapex.in,https://www.growthapex.in"
EOF

cat > "$CFG/aw-server-rust/config.toml" <<'EOF'
cors = ["https://growthapex.in", "https://www.growthapex.in"]
EOF

if [ ! -d "/Applications/ActivityWatch.app" ] && [ ! -d "$HOME/Applications/ActivityWatch.app" ]; then
  echo "ActivityWatch is not installed. Please install it first: https://activitywatch.net/downloads/"
  exit 1
fi

# Restart ActivityWatch so it picks up the setting
osascript -e 'quit app "ActivityWatch"' >/dev/null 2>&1 || true
pkill -f aw-server >/dev/null 2>&1 || true
pkill -f aw-qt >/dev/null 2>&1 || true
sleep 3
open -a ActivityWatch

# Check: does ActivityWatch now allow growthapex.in? (waits up to ~40 s for it to start)
echo "Checking the connection..."
for i in $(seq 1 20); do
  if curl -s -i -H "Origin: https://growthapex.in" http://localhost:5600/api/0/info 2>/dev/null | grep -qi "access-control-allow-origin"; then
    echo ""
    echo "DONE - ActivityWatch is connected to GrowthApex EMS."
    echo "Now open the EMS dashboard in Chrome and press Cmd+Shift+R - it should say: Screen activity: connected"
    exit 0
  fi
  sleep 2
done
echo ""
echo "NOT CONNECTED YET - ActivityWatch did not accept growthapex.in."
echo "Quit ActivityWatch from the menu bar icon, open it again, and run the command once more."
echo "If it still fails, send a screenshot of this window to the admin."
exit 1
