#!/bin/sh
echo "Installing dependencies for Termux..."
pkg update
pkg install nodejs

echo ""
echo "Setup complete! No npm install needed."
echo "You can now run:"
echo "  MOBILE_MODE=1 node bridge/server.js &"
echo "  ./target/release/where-is-my-train"
