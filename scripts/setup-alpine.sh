#!/bin/sh
# Run once on iSH to set up the full app

set -e
echo "=== Setting up Where Is My Train on Alpine Linux ==="

# 1. System deps
apk add --no-cache \
  nodejs npm \
  rust cargo \
  sqlite \
  curl git

# 2. Node bridge deps (no Puppeteer on Alpine)
cd bridge
npm install --omit=dev
npm uninstall puppeteer 2>/dev/null || true
npm install cheerio node-fetch
cd ..

# 3. Build Rust TUI
# Alpine uses musl — need musl target
rustup target add x86_64-unknown-linux-musl 2>/dev/null || true
cargo build --release

echo ""
echo "=== Setup complete! Run with: ==="
echo "  MOBILE_MODE=1 node bridge/server.js &"
echo "  ./target/release/where-is-my-train"
