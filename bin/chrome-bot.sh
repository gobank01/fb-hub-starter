#!/bin/bash
# Launch the mini's Chrome with a dedicated bot profile + CDP on port 9222.
# Runs inside the GUI session (called from a hub job), so a real window appears.
PORT=9222
if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "chrome-bot: already running"
  exit 0
fi

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$HOME/chrome-bot" \
  --no-first-run --no-default-browser-check \
  >/dev/null 2>&1 &

for _ in $(seq 1 25); do
  sleep 1
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "chrome-bot: started on $PORT"
    exit 0
  fi
done
echo "chrome-bot: failed to start"
exit 1
