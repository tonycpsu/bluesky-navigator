#!/bin/bash
set -e

# Start Xvfb in the background
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 2

# Export display for Firefox
export DISPLAY=:99

# Run the tests with any passed arguments
npm test -- "$@"

# Cleanup
kill $XVFB_PID 2>/dev/null || true
