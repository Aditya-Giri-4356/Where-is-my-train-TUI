#!/bin/sh
echo "Installing dependencies for iSH (Alpine Linux)..."
apk update
apk add nodejs

echo ""
echo "Setup complete! No npm install needed."
echo "You can now run:"
echo "  MOBILE_MODE=1 node bridge/server.mobile.js &"
echo "  ./target/release/where-is-my-train"
