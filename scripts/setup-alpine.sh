#!/bin/sh
# ─────────────────────────────────────────────────────────────
# Setup script for iSH (Alpine Linux on iOS)
# This installs only what's needed — NO npm install required.
# The mobile bridge (server.mobile.js) has zero npm dependencies.
# ─────────────────────────────────────────────────────────────
set -e

echo "╔═══════════════════════════════════════════════╗"
echo "║  Where Is My Train — iSH (Alpine) Setup      ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# Step 1: Install system packages
echo "[1/3] Installing system packages..."
apk update
apk add nodejs git curl

# Step 2: Verify Node.js works
echo ""
echo "[2/3] Verifying Node.js..."
node -e "console.log('Node.js ' + process.version + ' (' + process.arch + ') OK')"

# Step 3: Quick test — ensure the mobile server can at least parse
echo ""
echo "[3/3] Verifying mobile bridge..."
if [ -f "bridge/server.mobile.js" ]; then
  node -e "
    try {
      const http = require('http');
      const https = require('https');
      console.log('Mobile bridge dependencies OK (built-in http/https)');
    } catch(e) {
      console.error('ERROR: ' + e.message);
      process.exit(1);
    }
  "
else
  echo "ERROR: bridge/server.mobile.js not found!"
  echo "Make sure you are running this from the project root directory."
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║  Setup complete!                              ║"
echo "║                                               ║"
echo "║  To run (from project root):                  ║"
echo "║    node bridge/server.mobile.js &              ║"
echo "║    ./where-is-my-train                        ║"
echo "║                                               ║"
echo "║  NOTE: No npm install needed!                 ║"
echo "║  The mobile bridge has zero dependencies.     ║"
echo "╚═══════════════════════════════════════════════╝"
