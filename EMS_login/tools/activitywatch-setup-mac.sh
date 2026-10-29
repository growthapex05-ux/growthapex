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

echo ""
echo "DONE - ActivityWatch is connected to GrowthApex EMS."
echo "Now refresh the EMS dashboard -> Attendance. It should say: Screen activity: connected"
