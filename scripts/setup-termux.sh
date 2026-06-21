#!/bin/sh
# Run once in Termux

set -e
echo "=== Setting up Where Is My Train on Termux ==="

# 1. System deps
pkg update -y
pkg install -y \
  nodejs \
  rust \
  sqlite \
  curl git

# 2. Node bridge — no Puppeteer on Android
cd bridge
npm install --omit=dev
npm uninstall puppeteer 2>/dev/null || true  
npm install cheerio node-fetch
cd ..

# 3. Build Rust (Termux is ARM64 natively)
cargo build --release

echo ""
echo "=== Setup complete! Run with: ==="
echo "  MOBILE_MODE=1 node bridge/server.js &"
echo "  ./target/release/where-is-my-train"
