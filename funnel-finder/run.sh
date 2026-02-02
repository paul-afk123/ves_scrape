#!/bin/bash
# Adds Node/npm to PATH and runs the app (no coding needed).
# Double-click or run in terminal:  ./run.sh   or:  bash run.sh

# Use Node from your other project (or set NODE_BIN to any folder that has node + npm)
NODE_BIN="/Users/paul.pamfil/ads_helper/.node-local/bin"
if [[ ! -x "$NODE_BIN/node" ]]; then
  echo "Node not found at $NODE_BIN"
  echo "Install Node from https://nodejs.org and try again."
  exit 1
fi

export PATH="$NODE_BIN:$PATH"
cd "$(dirname "$0")"

echo "Installing dependencies (first time may take a minute)..."
npm install
if [[ $? -ne 0 ]]; then
  echo "npm install failed. Stop."
  exit 1
fi

echo ""
echo "Starting Funnel Finder at http://localhost:3000"
echo "Press Ctrl+C to stop."
echo ""
npm run dev
